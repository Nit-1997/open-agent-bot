import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createUsageRepo } from "../../src/limits/usageRepo.js";
import { createServiceClient } from "../../src/store/client.js";
import { admin, cleanup, closeHarness, createUser, localEnv, sql } from "./harness.js";

const SUPABASE = resolve(import.meta.dirname, "../../../supabase");
const BODY_RE = /create (?:or replace )?function private\.handle_new_user\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/;

const bodyIn = (file: string) => {
  const m = BODY_RE.exec(readFileSync(resolve(SUPABASE, file), "utf8"));
  if (!m) throw new Error(`no handle_new_user body in ${file}`);
  return m[1];
};

const db = () => createServiceClient({ supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey });
const repo = (now?: () => Date) => createUsageRepo(db(), { caps: { perMonth: 100, perHour: 100 }, now });

const deleteUser = async (id: string) => {
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error) throw error;
};

const hashOf = async (email: string) => {
  const [row] = await sql<{ hash: Buffer }>("select sha256(convert_to(lower($1), 'UTF8') || pepper) as hash from private.signup_pepper", [
    email,
  ]);
  return row.hash;
};

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

describe("account delete and the usage tombstone (D23)", () => {
  it("cascades usage, the request log and the human check away with the user", async () => {
    const u = await createUser({ invited: false });
    await repo().admit(u.id);
    await repo().humanCheck.set(u.id);
    await deleteUser(u.id);
    const [left] = await sql<{ n: number }>(
      `select (select count(*) from public.request_usage where user_id = $1)
            + (select count(*) from public.request_log where user_id = $1)
            + (select count(*) from public.human_checks where user_id = $1)::int as n`,
      [u.id],
    );
    expect(Number(left.n)).toBe(0);
  });

  it("stores a peppered email hash, the month's count and the check time, never the email", async () => {
    const u = await createUser({ invited: false });
    for (let i = 0; i < 2; i++) await repo().admit(u.id);
    await repo().humanCheck.set(u.id);
    await repo().tombstone(u.id);
    const rows = await sql<{ email_hash: Buffer; count: number; checked: boolean; plain: boolean }>(
      `select t.email_hash, t.count, t.human_checked_at is not null as checked,
              t.email_hash = sha256(convert_to($2, 'UTF8')) as plain
         from private.usage_tombstones t where t.email_hash = $1`,
      [await hashOf(u.email), u.email],
    );
    expect(rows).toHaveLength(1);
    expect({ count: rows[0].count, checked: rows[0].checked, plain: rows[0].plain }).toEqual({ count: 2, checked: true, plain: false });
    const columns = await sql<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'private' and table_name = 'usage_tombstones' order by ordinal_position",
    );
    expect(columns.map((c) => c.column_name)).toEqual(["email_hash", "month", "count", "human_checked_at", "deleted_at"]);
  });

  it("writes nothing for an unknown user", async () => {
    const before = await sql<{ n: string }>("select count(*) as n from private.usage_tombstones");
    await repo().tombstone("00000000-0000-4000-8000-000000000000");
    expect(await sql("select count(*) as n from private.usage_tombstones")).toEqual(before);
  });

  it("prunes tombstones older than two months and keeps recent ones", async () => {
    const old = await createUser({ invited: false });
    const recent = await createUser({ invited: false });
    await repo(() => new Date(Date.now() - 70 * 86_400_000)).tombstone(old.id);
    await repo().tombstone(recent.id);
    await repo().prune();
    const left = await sql<{ email_hash: Buffer }>("select email_hash from private.usage_tombstones where email_hash = any($1::bytea[])", [
      [await hashOf(old.email), await hashOf(recent.email)],
    ]);
    expect(left.map((r) => r.email_hash.toString("hex"))).toEqual([(await hashOf(recent.email)).toString("hex")]);
  });

  it("keeps the profile insert of handle_new_user unchanged", async () => {
    const u = await createUser({ invited: false });
    const [row] = await sql<{ email: string; data: unknown; status: string; same_time: boolean }>(
      "select email, data, status, created_at = updated_at as same_time from public.profiles where user_id = $1",
      [u.id],
    );
    expect(row).toEqual({ email: u.email, data: {}, status: "active", same_time: true });
    const m7 = bodyIn("migrations/20261104092535_request_usage.sql");
    const old = bodyIn("migrations/20261101060619_profiles.sql");
    const insert = /insert into public\.profiles[^;]*;/;
    expect(m7.match(insert)?.[0]).toBe(old.match(insert)?.[0]);
  });

  it("restores the pre-M7 handle_new_user body with rollback/m7.sql", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    const src = async () =>
      (await client.query<{ prosrc: string }>("select prosrc from pg_proc where oid = 'private.handle_new_user()'::regprocedure")).rows[0]
        .prosrc;
    try {
      expect(await src()).toBe(bodyIn("migrations/20261104092535_request_usage.sql"));
      await client.query("begin");
      await client.query(readFileSync(resolve(SUPABASE, "rollback/m7.sql"), "utf8"));
      expect(await src()).toBe(bodyIn("migrations/20261101060619_profiles.sql"));
    } finally {
      await client.query("rollback");
      expect(await src()).toBe(bodyIn("migrations/20261104092535_request_usage.sql"));
      await client.end();
    }
  });
});
