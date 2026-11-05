import type { SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUsageRepo } from "../../src/limits/usageRepo.js";
import { createServiceClient } from "../../src/store/client.js";
import { admin, anon, cleanup, closeHarness, createUser, type LocalUser, localEnv, signIn, sql } from "./harness.js";

const TABLES = ["request_usage", "request_log", "human_checks"] as const;
const PRIVATE_TABLES = ["private.signup_pepper", "private.usage_tombstones"] as const;
const PRIVATE_READERS = ["service_role", "authenticator", "anon", "authenticated"] as const;

const RPCS = (user: string): [string, Record<string, unknown>][] => [
  ["request_admit", { p_user: user, p_month_cap: 10, p_hour_cap: 10 }],
  ["request_refund", { p_user: user, p_log_id: 1 }],
  ["request_usage_get", { p_user: user }],
  ["request_usage_summary", {}],
  ["request_usage_page", { p_query: "", p_at_least: null, p_limit: 5, p_offset: 0 }],
  ["request_log_prune", {}],
  ["human_check_get", { p_user: user }],
  ["human_check_set", { p_user: user }],
  ["usage_tombstone", { p_user: user }],
];

let member: LocalUser;
let memberClient: SupabaseClient;

beforeAll(async () => {
  member = await createUser({ invited: false });
  memberClient = (await signIn(member)).client;
  const repo = createUsageRepo(createServiceClient({ supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey }), {
    caps: { perMonth: 10, perHour: 10 },
  });
  await repo.admit(member.id);
  await repo.humanCheck.set(member.id);
});

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

const callers = () =>
  [
    ["anon", anon()],
    ["member JWT", memberClient],
  ] as const;

describe("RLS and grants through PostgREST", () => {
  it("returns nothing from the usage tables to anon or a signed-in user", async () => {
    for (const [who, client] of callers()) {
      for (const table of TABLES) {
        const { data, error } = await client.from(table).select("*");
        expect({ who, table, rows: data?.length ?? 0, code: error?.code }).toEqual({ who, table, rows: 0, code: "42501" });
        const write = await client.from(table).insert({ user_id: member.id } as never);
        expect({ who, table, code: write.error?.code }).toEqual({ who, table, code: "42501" });
      }
    }
  });

  it("refuses every usage RPC to anon or a signed-in user", async () => {
    for (const [who, client] of callers()) {
      for (const [fn, args] of RPCS(member.id)) {
        const { data, error } = await client.rpc(fn, args);
        expect({ who, fn, data: data ?? null, refused: ["42501", "PGRST202"].includes(error?.code ?? "") }).toEqual({
          who,
          fn,
          data: null,
          refused: true,
        });
      }
    }
    expect(await sql("select count from public.request_usage where user_id = $1", [member.id])).toEqual([{ count: 1 }]);
  });

  it("lets the service role read the tables and call the RPCs", async () => {
    const { data, error } = await admin().from("request_usage").select("count").eq("user_id", member.id);
    expect(error).toBeNull();
    expect(data).toEqual([{ count: 1 }]);
    const summary = await admin().rpc("request_usage_summary", {});
    expect(summary.error).toBeNull();
    expect(await admin().rpc("human_check_get", { p_user: member.id })).toMatchObject({ data: true, error: null });
  });
});

describe("the signup pepper and the tombstones", () => {
  it("are not readable by service_role, authenticator, anon or authenticated", async () => {
    for (const role of PRIVATE_READERS)
      for (const table of PRIVATE_TABLES) {
        const [row] = await sql<{ readable: boolean }>("select has_table_privilege($1, $2, 'select') as readable", [role, table]);
        expect({ role, table, ...row }).toEqual({ role, table, readable: false });
      }
  });

  it("refuses a read as service_role inside the database", async () => {
    const client = new pg.Client({ connectionString: localEnv().dbUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role service_role");
      await expect(client.query("select pepper from private.signup_pepper")).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("rollback");
      await client.end();
    }
  });

  it("is not reachable through PostgREST even with the secret key", async () => {
    const { data, error } = await admin().schema("private").from("signup_pepper").select("*");
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST106");
  });

  it("holds exactly one 32-byte pepper", async () => {
    expect(await sql("select octet_length(pepper) as bytes from private.signup_pepper")).toEqual([{ bytes: 32 }]);
  });
});
