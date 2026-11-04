import { afterEach, describe, expect, it, vi } from "vitest";
import { errorBody, errorStatus } from "@oab/core/http/handlers.js";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { Admission, RunTicket } from "@oab/core/policy/types.js";
import type { HumanCheckState, Limits } from "@oab/shared/usage";
import type { HumanCheckGate } from "../../src/signup/humanCheck.js";
import { humanCheckOff } from "../fixtures/humanCheck.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { RunSlots } from "../../src/limits/slots.js";
import { type UsageRepo, UsageRepoError } from "../../src/limits/usageRepo.js";
import { CHAT_1, CHAT_2 } from "../fixtures/users.js";
import { FakeUsageStore } from "./fakeUsage.js";

const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const DEFAULTS: Limits = { runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 };

type Setup = { limits?: Partial<Limits>; humanCheck?: HumanCheckGate; usage?: (inner: UsageRepo) => UsageRepo };

function setup(over: Setup = {}) {
  const clock = { now: T0 };
  const now = () => clock.now;
  const store = new FakeUsageStore(() => new Date(clock.now));
  const limits = { ...DEFAULTS, ...over.limits };
  const repo = store.repo({ caps: { perMonth: limits.perMonth, perHour: limits.perHour } });
  const usage = over.usage ? over.usage(repo) : repo;
  const slots = new RunSlots({ staleAfterMs: 340_000, now });
  const limiter = new RateLimiter({ now });
  const policy = new HostedRunPolicy({ limits, usage, slots, humanCheck: over.humanCheck ?? humanCheckOff, limiter, now });
  const user = (): Principal => ({ ...store.newUser(), capabilities: NO_CAPABILITIES });
  const admit = (principal: Principal, chatId = CHAT_1, runId = `r-${Math.random().toString(36).slice(2, 8)}`) =>
    policy.admit({ principal, chatId, runId });
  return { clock, store, repo, usage, slots, limiter, policy, user, admit, limits };
}

function ticketOf(a: Admission): RunTicket {
  if (!a.ok) throw new Error(`refused: ${a.error.opts.code} ${a.error.message}`);
  return a.ticket;
}

function refusal(a: Admission) {
  if (a.ok) throw new Error("admitted");
  return { status: errorStatus(a.error), body: errorBody(a.error), retryAfter: a.error.opts.retryAfter };
}

const codeOf = (a: Admission) => (a.ok ? "ok" : a.error.opts.code);

const gate = (state: HumanCheckState | (() => Promise<HumanCheckState>)): HumanCheckGate & { calls: number } => {
  const g = {
    calls: 0,
    async state() {
      g.calls++;
      return typeof state === "function" ? state() : state;
    },
  };
  return g;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HostedRunPolicy admission", () => {
  it("admits a run, charges it once and holds one running slot until the ticket ends", async () => {
    const s = setup();
    const alice = s.user();
    const t = ticketOf(await s.admit(alice));
    expect(s.store.monthCount(alice.id, "2026-11-01")).toBe(1);
    expect(s.repo.calls).toBe(1);
    expect(s.policy.snapshot().running).toBe(1);
    expect(s.policy.snapshot().runningOf(alice.id)).toBe(1);
    t.end();
    t.end();
    expect(s.policy.snapshot().running).toBe(0);
  });

  it("refuses a second run for the same user with limit_running, 5 s retry and no charge", async () => {
    const s = setup();
    const alice = s.user();
    ticketOf(await s.admit(alice));
    const r = refusal(await s.admit(alice, CHAT_2));
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({
      error: "limit_running",
      message: "You can run one chat at a time. Wait for the other one to finish or stop it.",
      retryAfter: 5,
      limit: 1,
      used: 1,
      window: "running",
    });
    expect(s.store.monthCount(alice.id, "2026-11-01")).toBe(1);
    expect(s.repo.calls).toBe(1);
  });

  it("names the configured per-user cap in the limit_running message", async () => {
    const s = setup({ limits: { runningPerUser: 2 } });
    const alice = s.user();
    ticketOf(await s.admit(alice));
    ticketOf(await s.admit(alice));
    expect(refusal(await s.admit(alice)).body.message).toBe(
      "You can run 2 chats at a time. Wait for one of the others to finish or stop it.",
    );
  });

  it("refuses the same runId in a second chat while the first runs, because slots are keyed by ticket id", async () => {
    const s = setup({ limits: { runningPerUser: 2 } });
    const alice = s.user();
    const first = ticketOf(await s.admit(alice, CHAT_1, "same-run"));
    const second = ticketOf(await s.admit(alice, CHAT_2, "same-run"));
    expect(s.policy.snapshot().runningOf(alice.id)).toBe(2);
    first.end();
    expect(s.policy.snapshot().runningOf(alice.id)).toBe(1);
    second.end();
    const one = setup();
    const bob = one.user();
    ticketOf(await one.admit(bob, CHAT_1, "same-run"));
    expect(codeOf(await one.admit(bob, CHAT_2, "same-run"))).toBe("limit_running");
  });

  it("lets one of two parallel admits for one user through and refuses the other limit_running", async () => {
    const s = setup();
    const alice = s.user();
    const codes = (await Promise.all([s.admit(alice), s.admit(alice)])).map(codeOf).sort();
    expect(codes).toEqual(["limit_running", "ok"]);
    expect(s.store.monthCount(alice.id, "2026-11-01")).toBe(1);
  });

  it("admits 8 of 9 parallel runs across users with a server cap of 8 and refuses one server_busy", async () => {
    const s = setup();
    const users = Array.from({ length: 9 }, () => s.user());
    const results = await Promise.all(users.map((u) => s.admit(u)));
    const codes = results.map(codeOf);
    expect(codes.filter((c) => c === "ok")).toHaveLength(8);
    expect(codes.filter((c) => c === "server_busy")).toHaveLength(1);
    const busy = refusal(results.find((r) => !r.ok)!);
    expect(busy.status).toBe(429);
    expect(busy.body).toMatchObject({
      error: "server_busy",
      message: "The demo server is at capacity right now. Try again in a minute.",
      retryAfter: 60,
      limit: 8,
      window: "server",
    });
    expect(s.repo.calls).toBe(8);
  });

  it("holds the server cap under 100 parallel admits across 100 users", async () => {
    const s = setup({ limits: { runningServer: 50 } });
    const users = Array.from({ length: 100 }, () => s.user());
    const codes = (await Promise.all(users.map((u) => s.admit(u)))).map(codeOf);
    expect(codes.filter((c) => c === "ok")).toHaveLength(50);
    expect(codes.filter((c) => c === "server_busy")).toHaveLength(50);
    expect(s.policy.snapshot().running).toBe(50);
    expect(s.repo.calls).toBe(50);
  });

  it("refuses the 4th run of a month with limit_monthly, retryAt the next UTC month and the D8 body", async () => {
    const s = setup({ limits: { perMonth: 3 } });
    const alice = s.user();
    for (let i = 0; i < 3; i++) ticketOf(await s.admit(alice)).end();
    const r = refusal(await s.admit(alice));
    const retryAfter = Math.ceil((Date.parse("2026-12-01T00:00:00.000Z") - T0) / 1000);
    expect(r.status).toBe(429);
    expect(r.retryAfter).toBe(retryAfter);
    expect(r.body).toEqual({
      error: "limit_monthly",
      message: "You've used this month's 3 requests.",
      retryAfter,
      retryAt: "2026-12-01T00:00:00.000Z",
      limit: 3,
      used: 3,
      window: "month",
    });
    expect(s.store.monthCount(alice.id, "2026-11-01")).toBe(3);
    expect(s.policy.snapshot().running).toBe(0);
  });

  it("refuses the 3rd run in an hour with limit_hourly until the oldest run is an hour old", async () => {
    const s = setup({ limits: { perHour: 2 } });
    const alice = s.user();
    ticketOf(await s.admit(alice)).end();
    s.clock.now += 20 * 60_000;
    ticketOf(await s.admit(alice)).end();
    s.clock.now += 39 * 60_000 + 20_000;
    const r = refusal(await s.admit(alice));
    expect(r.body).toEqual({
      error: "limit_hourly",
      message: "You're sending messages quickly. Try again in 40 seconds.",
      retryAfter: 40,
      retryAt: new Date(T0 + 3_600_000).toISOString(),
      limit: 2,
      used: 2,
      window: "hour",
    });
    s.clock.now = T0 + 3_600_000;
    expect(codeOf(await s.admit(alice))).toBe("ok");
  });
});

describe("HostedRunPolicy cheap checks before the database", () => {
  it("answers the 61st admit attempt in 10 minutes with limit_attempts and no database call", async () => {
    const s = setup({ limits: { perHour: 1000, perMonth: 1000 } });
    const alice = s.user();
    for (let i = 0; i < 60; i++) ticketOf(await s.admit(alice)).end();
    expect(s.repo.calls).toBe(60);
    const r = refusal(await s.admit(alice));
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ error: "limit_attempts", retryAfter: 600, window: "attempts", limit: 60 });
    expect(r.body.message).toBe("You're sending messages quickly. Try again in 600 seconds.");
    expect(s.repo.calls).toBe(60);
    expect(s.policy.snapshot().running).toBe(0);
  });

  it("serves a cached monthly refusal without a database call, recomputing retryAfter", async () => {
    const s = setup({ limits: { perMonth: 1 } });
    const alice = s.user();
    ticketOf(await s.admit(alice)).end();
    const first = refusal(await s.admit(alice));
    expect(s.repo.calls).toBe(2);
    s.clock.now += 10_000;
    const again = refusal(await s.admit(alice));
    expect(s.repo.calls).toBe(2);
    expect(again.body).toMatchObject({ error: "limit_monthly", retryAt: first.body.retryAt, limit: 1, used: 1 });
    expect(again.body.message).toBe("You've used this month's 1 request.");
    expect(again.retryAfter).toBe((first.retryAfter as number) - 10);
    s.clock.now = Date.parse("2026-12-01T00:00:00.000Z");
    expect(codeOf(await s.admit(alice))).toBe("ok");
    expect(s.repo.calls).toBe(3);
  });

  it("serves a cached hourly refusal until retryAt passes", async () => {
    const s = setup({ limits: { perHour: 1 } });
    const alice = s.user();
    ticketOf(await s.admit(alice)).end();
    expect(codeOf(await s.admit(alice))).toBe("limit_hourly");
    expect(codeOf(await s.admit(alice))).toBe("limit_hourly");
    expect(s.repo.calls).toBe(2);
    s.clock.now = T0 + 3_600_000;
    expect(codeOf(await s.admit(alice))).toBe("ok");
    expect(s.repo.calls).toBe(3);
  });

  it("clears the refusal cache when the user gets a refund", async () => {
    const s = setup({ limits: { perMonth: 1, runningPerUser: 2 } });
    const alice = s.user();
    const t = ticketOf(await s.admit(alice));
    expect(codeOf(await s.admit(alice))).toBe("limit_monthly");
    t.refund?.();
    await vi.waitFor(() => expect(s.store.monthCount(alice.id, "2026-11-01")).toBe(0));
    t.end();
    expect(codeOf(await s.admit(alice))).toBe("ok");
  });

  it("checks attempts, then the cache, then the human check, then per-user, then the server, then the database", async () => {
    const order: string[] = [];
    const human = gate(async () => {
      order.push("human");
      return "off";
    });
    const s = setup({
      humanCheck: human,
      limits: { perMonth: 1, runningServer: 1 },
      usage: (inner) => ({
        ...inner,
        humanCheck: inner.humanCheck,
        admit: (id) => {
          order.push("db");
          return inner.admit(id);
        },
      }),
    });
    const take = vi.spyOn(s.limiter, "take");
    const alice = s.user();
    const bob = s.user();
    const t = ticketOf(await s.admit(alice));
    expect(order).toEqual(["human", "db"]);
    order.length = 0;
    expect(codeOf(await s.admit(alice))).toBe("limit_running");
    expect(codeOf(await s.admit(bob))).toBe("server_busy");
    expect(order).toEqual(["human", "human"]);
    t.end();
    order.length = 0;
    expect(codeOf(await s.admit(alice))).toBe("limit_monthly");
    expect(codeOf(await s.admit(alice))).toBe("limit_monthly");
    expect(order).toEqual(["human", "db"]);
    expect(take.mock.calls.every(([key]) => key.startsWith("admit:"))).toBe(true);
  });

  it("refuses limit_attempts before consulting the cache, the human check or the slots", async () => {
    const human = gate("off");
    const s = setup({ humanCheck: human, limits: { perHour: 1000, perMonth: 1000 } });
    const alice = s.user();
    for (let i = 0; i < 60; i++) s.limiter.take(`admit:${alice.id}`, { max: 60, windowMs: 600_000 });
    expect(codeOf(await s.admit(alice))).toBe("limit_attempts");
    expect(human.calls).toBe(0);
    expect(s.repo.calls).toBe(0);
  });
});

describe("HostedRunPolicy human check gate", () => {
  it("refuses with 403 human_check_required and no charge when the check is required", async () => {
    const s = setup({ humanCheck: gate("required") });
    const r = refusal(await s.admit(s.user()));
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "human_check_required", message: "Confirm you're human before your first message." });
    expect(s.repo.calls).toBe(0);
    expect(s.policy.snapshot().running).toBe(0);
  });

  it.each([
    ["unavailable", gate("unavailable")],
    ["throws", gate(() => Promise.reject(new Error("lookup failed")))],
  ])("answers 503 human_check_unavailable when the gate is %s", async (_name, g) => {
    const s = setup({ humanCheck: g });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = refusal(await s.admit(s.user()));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({
      error: "human_check_unavailable",
      message: "Sign-up checks are unavailable right now. Try again in a minute.",
      retryAfter: 60,
    });
    expect(s.repo.calls).toBe(0);
  });
});

describe("HostedRunPolicy fails closed", () => {
  it("answers 503 usage_unavailable on a database error, releases the slot and admits nothing", async () => {
    const s = setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const alice = s.user();
    s.repo.failWith = new UsageRepoError("admit", "PGRST202");
    const r = refusal(await s.admit(alice));
    expect(r.status).toBe(503);
    expect(r.retryAfter).toBe(60);
    expect(r.body).toMatchObject({ error: "usage_unavailable", message: "Can't check your usage right now. Try again in a minute." });
    expect(s.policy.snapshot().running).toBe(0);
    s.repo.failWith = undefined;
    expect(codeOf(await s.admit(alice))).toBe("ok");
  });

  it("answers 503 usage_unavailable when the database call takes longer than 3 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ usage: (inner) => ({ ...inner, admit: () => new Promise(() => {}) }) });
    const pending = s.admit(s.user());
    await vi.advanceTimersByTimeAsync(3000);
    expect(codeOf(await pending)).toBe("usage_unavailable");
    expect(s.policy.snapshot().running).toBe(0);
  });

  it("never reads the principal's capabilities", async () => {
    const s = setup();
    const capabilities = new Proxy({} as Principal["capabilities"], {
      get() {
        throw new Error("the policy read capabilities");
      },
    });
    const u = s.store.newUser();
    expect(codeOf(await s.policy.admit({ principal: { ...u, capabilities }, chatId: CHAT_1, runId: "r" }))).toBe("ok");
  });
});

describe("HostedRunPolicy tickets", () => {
  it("refunds once through the repo, and a refund error is logged, not thrown", async () => {
    const s = setup();
    const alice = s.user();
    const t = ticketOf(await s.admit(alice));
    t.refund?.();
    t.refund?.();
    await vi.waitFor(() => expect(s.store.monthCount(alice.id, "2026-11-01")).toBe(0));
    expect(s.repo.calls).toBe(2);
    t.end();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t2 = ticketOf(await s.admit(alice, CHAT_2));
    s.repo.failWith = new UsageRepoError("refund", "timeout");
    expect(() => t2.refund?.()).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn.mock.calls.flat().join(" ")).toContain("[limits] refund failed");
  });

  it("force-releases a leaked slot after RUN_TIME_LIMIT_SECONDS + 60, and a late end() changes no count", async () => {
    const s = setup({ limits: { runningServer: 2, runningPerUser: 1 } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const alice = s.user();
    const bob = s.user();
    const leaked = ticketOf(await s.admit(alice));
    s.clock.now += 100_000;
    ticketOf(await s.admit(bob));
    s.clock.now = T0 + 340_001;
    s.policy.sweep();
    expect(s.policy.snapshot()).toMatchObject({ running: 1, staleReleased: 1 });
    expect(s.policy.snapshot().runningOf(alice.id)).toBe(0);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/\[limits\] released a stale run slot user=\S+ run=\S+ age=340s/);
    leaked.end();
    expect(s.policy.snapshot()).toMatchObject({ running: 1, staleReleased: 1 });
    expect(s.policy.snapshot().runningOf(bob.id)).toBe(1);
  });

  it("releases the slot on every kind of refusal", async () => {
    const s = setup({ limits: { perMonth: 1, runningServer: 2 } });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const alice = s.user();
    const bob = s.user();
    const carol = s.user();
    ticketOf(await s.admit(alice)).end();
    expect(codeOf(await s.admit(alice))).toBe("limit_monthly");
    expect(s.policy.snapshot().running).toBe(0);
    s.repo.failWith = new UsageRepoError("admit", "unreachable");
    expect(codeOf(await s.admit(bob))).toBe("usage_unavailable");
    expect(s.policy.snapshot().running).toBe(0);
    s.repo.failWith = undefined;
    const b = ticketOf(await s.admit(bob));
    ticketOf(await s.admit(carol));
    expect(codeOf(await s.admit(bob))).toBe("limit_running");
    expect(codeOf(await s.admit(s.user()))).toBe("server_busy");
    expect(s.policy.snapshot().running).toBe(2);
    b.end();
    expect(s.policy.snapshot().running).toBe(1);
  });
});
