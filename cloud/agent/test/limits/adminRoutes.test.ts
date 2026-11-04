import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import type { PageResponse } from "@oab/shared/pages";
import { type AdminUsageDetail, type AdminUsageRow, type AdminUsageSummary, type Limits, nextUtcMonth } from "@oab/shared/usage";
import { UsageRepoError } from "../../src/limits/usageRepo.js";
import { makeHostedApp } from "../fixtures/hostedApp.js";
import { fakeUsageDeps, TEST_LIMITS } from "../fixtures/usage.js";
import { ADMIN, ALICE, BOB, CHAT_1 } from "../fixtures/users.js";

const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const LIMITS: Limits = { ...TEST_LIMITS, perMonth: 3 };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function seeded(n: number, opts: { limits?: Limits; signupMode?: () => Promise<"waitlist" | "unknown"> } = {}) {
  const clock = { now: T0 };
  const h = await makeHostedApp({
    usage: (limiter) => fakeUsageDeps(limiter, opts.limits ?? LIMITS, () => new Date(clock.now)),
    ...(opts.signupMode && { signupMode: opts.signupMode }),
  });
  const people: Principal[] = [];
  for (let i = 1; i <= n; i++) {
    const p: Principal = { id: uuid(i), email: `person${i}@example.test`, capabilities: NO_CAPABILITIES };
    h.accounts.add(p);
    h.usage.store.newUser(p.email, p.id);
    clock.now += 60_000;
    await h.usage.usage.admit(p.id);
    people.push(p);
  }
  const get = async <T>(path: string) => {
    const res = await h.call(ADMIN, path);
    return { status: res.status, body: (await res.json()) as T };
  };
  return { h, clock, people, get };
}

afterEach(() => vi.restoreAllMocks());

const PATHS = ["/admin/usage/summary", "/admin/usage/users", `/admin/usage/users/${uuid(1)}`];

describe("admin usage routes: who may call them", () => {
  it("answers 404 not_found to members, never usage data", async () => {
    const { h } = await seeded(2);
    for (const who of [ALICE, BOB])
      for (const path of PATHS) {
        const res = await h.call(who, path);
        expect(res.status, `${who.email} ${path}`).toBe(404);
        expect(await res.json()).toEqual({ error: "not_found", message: "Not found." });
      }
    expect(h.usage.usage.calls).toBe(2);
  });

  it("answers 404 to an admin claim that the live check denies, and 503 when the check fails", async () => {
    let live: () => Promise<boolean> = async () => false;
    const h = await makeHostedApp({ seams: { isLiveAdmin: () => live() } });
    for (const path of PATHS) expect((await h.call(ADMIN, path)).status).toBe(404);
    live = async () => Promise.reject(new Error("auth admin down"));
    for (const path of PATHS) expect((await h.call(ADMIN, path)).status).toBe(503);
  });

  it("shares the admin rate limit with the other admin routes", async () => {
    const { h } = await seeded(0);
    for (let i = 0; i < 120; i++) expect((await h.call(ADMIN, i % 2 ? "/admin/usage/summary" : "/admin/users")).status).toBe(200);
    const res = await h.call(ADMIN, "/admin/usage/users");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("GET /admin/usage/summary", () => {
  it("shows the month totals, running now, the configured limits and the signup mode", async () => {
    const { h, people, get } = await seeded(3);
    const ticket = await h.usage.policy.admit({ principal: people[0]!, chatId: CHAT_1, runId: "r1" });
    const { status, body } = await get<AdminUsageSummary>("/admin/usage/summary");
    expect(status).toBe(200);
    expect(body).toEqual({
      month: { total: 4, activeUsers: 3, resetsAt: expect.stringMatching(/^\d{4}-\d{2}-01T00:00:00\.000Z$/) },
      running: { now: 1, limit: 8, staleReleased: 0 },
      limits: LIMITS,
      signupMode: "waitlist",
      signups: null,
    });
    if (ticket.ok) ticket.ticket.end();
    expect((await get<AdminUsageSummary>("/admin/usage/summary")).body.running.now).toBe(0);
  });

  it("reports an unknown signup mode as unknown and a failed lookup as unknown", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      (await (await seeded(0, { signupMode: async () => "unknown" })).get<AdminUsageSummary>("/admin/usage/summary")).body.signupMode,
    ).toBe("unknown");
    const broken = await seeded(0, { signupMode: async () => Promise.reject(new Error("down")) });
    expect((await broken.get<AdminUsageSummary>("/admin/usage/summary")).body.signupMode).toBe("unknown");
  });

  it("answers 503 usage_unavailable when the database fails, never zero numbers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { h, get } = await seeded(1);
    h.usage.usage.failWith = new UsageRepoError("summary", "timeout");
    const { status, body } = await get<Record<string, unknown>>("/admin/usage/summary");
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: "usage_unavailable", message: "Can't load usage right now. Try again in a minute." });
    expect(body).not.toHaveProperty("month");
  });
});

describe("GET /admin/usage/users", () => {
  it("lists 5 per page, most recent request first, with the total and the running dot", async () => {
    const { h, people, get } = await seeded(12);
    const ticket = await h.usage.policy.admit({ principal: people[10]!, chatId: CHAT_1, runId: "r1" });
    const first = await get<PageResponse<AdminUsageRow>>("/admin/usage/users");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 12, page: 1, pageSize: 5 });
    expect(first.body.items.map((r) => r.email)).toEqual([11, 12, 10, 9, 8].map((n) => `person${n}@example.test`));
    expect(first.body.items[0]).toEqual({
      id: uuid(11),
      email: "person11@example.test",
      monthUsed: 2,
      monthLimit: 3,
      lastAt: expect.any(String),
      runningNow: true,
    });
    expect(first.body.items.filter((r) => r.runningNow).map((r) => r.id)).toEqual([uuid(11)]);
    const third = await get<PageResponse<AdminUsageRow>>("/admin/usage/users?page=3");
    expect(third.body.items.map((r) => r.email)).toEqual(["person2@example.test", "person1@example.test"]);
    if (ticket.ok) ticket.ticket.end();
  });

  it("returns an empty page with the real total past the end, so the client can step back", async () => {
    const { get } = await seeded(7);
    expect((await get<PageResponse<AdminUsageRow>>("/admin/usage/users?page=4")).body).toEqual({
      items: [],
      total: 7,
      page: 4,
      pageSize: 5,
    });
    expect((await get<PageResponse<AdminUsageRow>>("/admin/usage/users?page=10000")).body).toMatchObject({ items: [], total: 7 });
  });

  it("ignores a client page size and a client cap", async () => {
    const { h, get } = await seeded(7);
    const page = vi.spyOn(h.usage.usage, "page");
    const { body } = await get<PageResponse<AdminUsageRow>>("/admin/usage/users?pageSize=50&limit=50&atLeast=1&cap=1");
    expect(body.items).toHaveLength(5);
    expect(page).toHaveBeenLastCalledWith({ limit: 5, offset: 0 });
  });

  it("filters at_limit with the cap from server config only", async () => {
    const { h, clock, people, get } = await seeded(6);
    for (const p of [people[1]!, people[4]!]) {
      clock.now += 60_000;
      for (let i = 0; i < 2; i++) await h.usage.usage.admit(p.id);
    }
    const page = vi.spyOn(h.usage.usage, "page");
    const { body } = await get<PageResponse<AdminUsageRow>>("/admin/usage/users?filter=at_limit&atLeast=1");
    expect(page).toHaveBeenLastCalledWith({ atLeast: 3, limit: 5, offset: 0 });
    expect(body.total).toBe(2);
    expect(body.items.map((r) => [r.email, r.monthUsed])).toEqual([
      ["person5@example.test", 3],
      ["person2@example.test", 3],
    ]);
    expect((await get<PageResponse<AdminUsageRow>>("/admin/usage/users?filter=all")).body.total).toBe(6);
  });

  it("searches email contains on the server, trimmed and case-insensitive, with wildcards taken literally", async () => {
    const { h, get } = await seeded(12);
    const page = vi.spyOn(h.usage.usage, "page");
    const { body } = await get<PageResponse<AdminUsageRow>>(`/admin/usage/users?q=${encodeURIComponent("  SON1  ")}`);
    expect(page).toHaveBeenLastCalledWith({ query: "SON1", limit: 5, offset: 0 });
    expect(body.total).toBe(4);
    expect(body.items.map((r) => r.email)).toEqual([
      "person12@example.test",
      "person11@example.test",
      "person10@example.test",
      "person1@example.test",
    ]);
    for (const q of ["person_", "%", "person%1"])
      expect((await get<PageResponse<AdminUsageRow>>(`/admin/usage/users?q=${encodeURIComponent(q)}`)).body.total, q).toBe(0);
    expect((await get<PageResponse<AdminUsageRow>>(`/admin/usage/users?q=${encodeURIComponent("   ")}`)).body.total).toBe(12);
  });

  it.each([
    ["page=0"],
    ["page=-1"],
    ["page=1.5"],
    ["page=abc"],
    ["page=10001"],
    ["page=1e3"],
    ["page="],
    ["filter=bogus"],
    ["filter=AT_LIMIT"],
    ["filter="],
    [`q=${"x".repeat(101)}`],
  ])("refuses %s with 400 invalid and no database call", async (query) => {
    const { h, get } = await seeded(1);
    const before = h.usage.usage.calls;
    const { status, body } = await get<{ error: string }>(`/admin/usage/users?${query}`);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid");
    expect(h.usage.usage.calls).toBe(before);
  });

  it("accepts q of exactly 100 characters", async () => {
    const { get } = await seeded(1);
    expect((await get(`/admin/usage/users?q=${"x".repeat(100)}`)).status).toBe(200);
  });

  it("answers 503 usage_unavailable when the database fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { h, get } = await seeded(1);
    h.usage.usage.failWith = new UsageRepoError("page", "unreachable");
    expect((await get<{ error: string }>("/admin/usage/users")).body.error).toBe("usage_unavailable");
  });
});

describe("GET /admin/usage/users/:id", () => {
  it("shows the status, month, hour with its reset, running now and the last request", async () => {
    const { h, clock, people, get } = await seeded(2);
    await h.usage.usage.admit(people[0]!.id);
    const firstAt = T0 + 60_000;
    const ticket = await h.usage.policy.admit({ principal: people[0]!, chatId: CHAT_1, runId: "r1" });
    const { status, body } = await get<AdminUsageDetail>(`/admin/usage/users/${uuid(1).toUpperCase()}`);
    expect(status).toBe(200);
    expect(body).toEqual({
      id: uuid(1),
      email: "person1@example.test",
      status: "active",
      month: { used: 3, limit: 3, resetsAt: nextUtcMonth(Date.now()).toISOString() },
      hour: { used: 3, limit: 10, resetsAt: new Date(firstAt + 3_600_000).toISOString() },
      running: { now: 1, limit: 1 },
      lastAt: new Date(clock.now).toISOString(),
    });
    if (ticket.ok) ticket.ticket.end();
  });

  it("shows a known user without usage this month with zeros and no last request", async () => {
    const { get } = await seeded(0);
    const { status, body } = await get<AdminUsageDetail>(`/admin/usage/users/${BOB.id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      email: BOB.email,
      month: { used: 0 },
      hour: { used: 0, resetsAt: null },
      running: { now: 0 },
      lastAt: null,
    });
  });

  it("refuses a non-uuid id with 400 and an unknown user with 404", async () => {
    const { h, get } = await seeded(1);
    const before = h.usage.usage.calls;
    for (const id of ["not-a-uuid", "1", `${uuid(1)}x`, "%25"]) {
      const { status, body } = await get<{ error: string }>(`/admin/usage/users/${id}`);
      expect(status, id).toBe(400);
      expect(body.error).toBe("invalid");
    }
    expect(h.usage.usage.calls).toBe(before);
    const missing = await get<{ error: string; message: string }>(`/admin/usage/users/${uuid(99)}`);
    expect(missing).toEqual({ status: 404, body: { error: "not_found", message: "That user doesn't exist." } });
  });

  it("answers 503 usage_unavailable when the database fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { h, get } = await seeded(1);
    h.usage.usage.failWith = new UsageRepoError("get", "timeout");
    expect((await get<{ error: string }>(`/admin/usage/users/${uuid(1)}`)).status).toBe(503);
  });
});
