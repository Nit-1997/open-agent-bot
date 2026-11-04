import { randomUUID } from "node:crypto";
import { type AuthEnv, NO_CAPABILITIES } from "@oab/core/identity/types.js";
import type { PageResponse } from "@oab/shared/pages";
import type { AdminUsageDetail, AdminUsageRow, AdminUsageSummary, Limits } from "@oab/shared/usage";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSignupSettings } from "../../src/signup/settings.js";
import { usageAdminRoutes } from "../../src/limits/adminRoutes.js";
import { createUsageRepo } from "../../src/limits/usageRepo.js";
import { createAdminRepo } from "../../src/store/admin.js";
import { createServiceClient } from "../../src/store/client.js";
import { cleanup, closeHarness, createUser, type LocalUser, localEnv, sql, testEmail } from "./harness.js";

const LIMITS: Limits = { runningPerUser: 1, perHour: 1000, perMonth: 3, runningServer: 8 };
const START = Date.parse("2093-06-10T08:00:00.000Z");
const clock = { now: START };
const run = randomUUID().slice(0, 6);
const users: LocalUser[] = [];
let app: Hono<AuthEnv>;

const db = () => createServiceClient({ supabaseUrl: localEnv().apiUrl, supabaseSecretKey: localEnv().secretKey });

const get = async <T>(path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T };
};

beforeAll(async () => {
  const repo = createUsageRepo(db(), { caps: { perMonth: LIMITS.perMonth, perHour: LIMITS.perHour }, now: () => new Date(clock.now) });
  for (let i = 0; i < 12; i++) {
    const u = await createUser({ email: testEmail(`adm${run}-${String(i).padStart(2, "0")}`), invited: false });
    users.push(u);
    clock.now += 60_000;
    const admits = i === 3 || i === 7 ? 3 : 1;
    for (let n = 0; n < admits; n++) expect((await repo.admit(u.id)).ok).toBe(true);
  }
  const running = users[11]!.id;
  const signup = createSignupSettings(db());
  app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    c.set("user", { id: randomUUID(), email: "admin@example.test", capabilities: { ...NO_CAPABILITIES, admin: true } });
    await next();
  });
  app.route(
    "/",
    usageAdminRoutes({
      usage: repo,
      policy: { snapshot: () => ({ running: 1, staleReleased: 0, runningOf: (id) => (id === running ? 1 : 0) }) },
      limits: LIMITS,
      profiles: createAdminRepo(db()).users,
      signupMode: () => signup.mode(),
      signupStats: () => signup.stats(),
      now: () => clock.now,
    }),
  );
});

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

const emailOf = (i: number) => users[i]!.email;

describe("admin usage routes on the local stack", () => {
  it("summarises the month from request_usage_summary", async () => {
    const { status, body } = await get<AdminUsageSummary>("/admin/usage/summary");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      month: { total: 16, activeUsers: 12, resetsAt: "2093-07-01T00:00:00.000Z" },
      running: { now: 1, limit: 8 },
      limits: LIMITS,
      signupMode: "waitlist",
      signups: { capHour: 20, capDay: 100, lastHour: expect.any(Number), lastDay: expect.any(Number) },
    });
  });

  it("pages 5 at a time newest first with the total from the separate CTE, also past the end", async () => {
    const first = await get<PageResponse<AdminUsageRow>>("/admin/usage/users");
    expect(first.body).toMatchObject({ total: 12, page: 1, pageSize: 5 });
    expect(first.body.items.map((r) => r.email)).toEqual([11, 10, 9, 8, 7].map(emailOf));
    expect(first.body.items[0]).toMatchObject({ id: users[11]!.id, monthUsed: 1, monthLimit: 3, runningNow: true });
    expect(first.body.items.slice(1).every((r) => !r.runningNow)).toBe(true);
    expect((await get<PageResponse<AdminUsageRow>>("/admin/usage/users?page=3")).body.items.map((r) => r.email)).toEqual(
      [1, 0].map(emailOf),
    );
    expect((await get<PageResponse<AdminUsageRow>>("/admin/usage/users?page=4")).body).toEqual({
      items: [],
      total: 12,
      page: 4,
      pageSize: 5,
    });
  });

  it("filters at_limit with the server cap", async () => {
    const { body } = await get<PageResponse<AdminUsageRow>>("/admin/usage/users?filter=at_limit");
    expect(body.total).toBe(2);
    expect(body.items.map((r) => [r.email, r.monthUsed])).toEqual([
      [emailOf(7), 3],
      [emailOf(3), 3],
    ]);
  });

  it("searches email contains case-insensitively and escapes LIKE wildcards", async () => {
    const one = await get<PageResponse<AdminUsageRow>>(`/admin/usage/users?q=${encodeURIComponent(`ADM${run}-05`)}`);
    expect(one.body.items.map((r) => r.email)).toEqual([emailOf(5)]);
    const all = await get<PageResponse<AdminUsageRow>>(`/admin/usage/users?q=${encodeURIComponent(`adm${run}-`)}`);
    expect(all.body.total).toBe(12);
    for (const q of ["%", "_", "\\", `adm${run}-0_`, `adm${run}%05`])
      expect((await get<PageResponse<AdminUsageRow>>(`/admin/usage/users?q=${encodeURIComponent(q)}`)).body.total, q).toBe(0);
  });

  it("shows a user's detail with the last request read from request_usage", async () => {
    const u = users[7]!;
    const [row] = await sql<{ last_at: Date }>("select last_at from public.request_usage where user_id = $1", [u.id]);
    const { status, body } = await get<AdminUsageDetail>(`/admin/usage/users/${u.id}`);
    expect(status).toBe(200);
    expect(body).toEqual({
      id: u.id,
      email: u.email,
      status: "active",
      month: { used: 3, limit: 3, resetsAt: "2093-07-01T00:00:00.000Z" },
      hour: { used: expect.any(Number), limit: 1000, resetsAt: expect.any(String) },
      running: { now: 0, limit: 1 },
      lastAt: row!.last_at.toISOString(),
    });
  });

  it("answers 404 for an unknown user and 400 for a non-uuid id", async () => {
    expect((await get(`/admin/usage/users/${randomUUID()}`)).status).toBe(404);
    expect((await get("/admin/usage/users/not-a-uuid")).status).toBe(400);
  });
});
