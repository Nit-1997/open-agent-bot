import { afterAll, describe, expect, it } from "vitest";
import { createUsageRepo, UsageRepoError } from "../../src/limits/usageRepo.js";
import { createServiceClient } from "../../src/store/client.js";
import { usageContract } from "../limits/usageContract.js";
import { admin, cleanup, closeHarness, createUser, localEnv, sql, testEmail } from "./harness.js";
import { USAGE_FUNCTIONS } from "./usageFunctions.js";

const db = () => createServiceClient({ supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey });

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

const monthCount = async (userId: string, month: string) => {
  const rows = await sql<{ count: number }>("select count from public.request_usage where user_id = $1 and month = $2::date", [
    userId,
    month,
  ]);
  return rows[0]?.count ?? 0;
};

usageContract("local Supabase stack", {
  repo: (opts) => createUsageRepo(db(), opts),
  email: (tag) => testEmail(tag),
  newUser: (email) => createUser({ email, invited: false }),
  deleteUser: async (id) => {
    const { error } = await admin().auth.admin.deleteUser(id);
    if (error) throw error;
  },
  monthCount,
});

describe("request_admit and request_refund on the database", () => {
  it("stores exactly 50 in request_usage after 100 parallel admits with a cap of 50", async () => {
    const u = await createUser({ invited: false });
    const repo = createUsageRepo(db(), { caps: { perMonth: 50, perHour: 1000 }, timeoutMs: 60_000 });
    const results = await Promise.all(Array.from({ length: 100 }, () => repo.admit(u.id)));
    expect(results.filter((r) => r.ok)).toHaveLength(50);
    const [row] = await sql<{ count: number; logs: number }>(
      "select u.count, (select count(*)::int from public.request_log l where l.user_id = u.user_id) as logs from public.request_usage u where u.user_id = $1",
      [u.id],
    );
    expect(row).toEqual({ count: 50, logs: 50 });
  });

  it("never decrements below 0", async () => {
    const u = await createUser({ invited: false });
    const repo = createUsageRepo(db(), { caps: { perMonth: 10, perHour: 10 } });
    const r = await repo.admit(u.id);
    if (!r.ok) throw new Error("expected an admit");
    await sql("update public.request_usage set count = 0 where user_id = $1", [u.id]);
    await repo.refund(u.id, r.logId);
    expect(await sql("select count from public.request_usage where user_id = $1", [u.id])).toEqual([{ count: 0 }]);
    expect(await sql("select 1 from public.request_log where id = $1", [r.logId])).toHaveLength(0);
  });

  it("refuses invalid arguments with 22023", async () => {
    const u = await createUser({ invited: false });
    for (const [cap, hour] of [
      [0, 10],
      [10, 0],
    ])
      await expect(createUsageRepo(db(), { caps: { perMonth: cap, perHour: hour } }).admit(u.id)).rejects.toMatchObject({
        code: "22023",
      });
  });

  it("reports an unknown user as a foreign-key error, not an admit", async () => {
    const repo = createUsageRepo(db(), { caps: { perMonth: 10, perHour: 10 } });
    await expect(repo.admit("00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(UsageRepoError);
  });

  it("times out as a UsageRepoError with code timeout", async () => {
    const u = await createUser({ invited: false });
    const slow = createServiceClient(
      { supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey },
      {
        fetch: (_input, init) =>
          new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      },
    );
    await expect(createUsageRepo(slow, { caps: { perMonth: 10, perHour: 10 }, timeoutMs: 50 }).get(u.id)).rejects.toMatchObject({
      code: "timeout",
    });
  });
});

describe("function grants", () => {
  it("lets only service_role execute the usage functions", async () => {
    for (const fn of USAGE_FUNCTIONS) {
      const [row] = await sql<Record<string, boolean>>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authenticated,
                has_function_privilege('service_role', $1, 'execute') as service_role`,
        [fn],
      );
      expect({ fn, ...row }).toEqual({ fn, anon: false, authenticated: false, service_role: true });
    }
  });

  it("runs every function with an empty search_path, and only the private-table writers as security definer", async () => {
    const rows = await sql<{ fn: string; definer: boolean; config: string[] | null }>(
      "select p.oid::regprocedure::text as fn, p.prosecdef as definer, p.proconfig as config from pg_proc p where p.oid = any($1::regprocedure[]) order by 1",
      [USAGE_FUNCTIONS],
    );
    expect(rows).toHaveLength(USAGE_FUNCTIONS.length);
    for (const r of rows) expect(r.config, r.fn).toEqual(['search_path=""']);
    expect(rows.filter((r) => r.definer).map((r) => r.fn.split("(")[0])).toEqual(["request_log_prune", "usage_tombstone"]);
  });

  it("checks that the month column only takes the first of a month", async () => {
    const u = await createUser({ invited: false, email: testEmail("month") });
    await expect(sql("insert into public.request_usage (user_id, month) values ($1, '2031-01-02')", [u.id])).rejects.toMatchObject({
      code: "23514",
    });
  });
});
