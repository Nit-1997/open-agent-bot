import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthEnv, NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { HumanCheckState, Limits, UsageView } from "@oab/shared/usage";
import type { HumanCheckGate } from "../../src/signup/humanCheck.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { usageRoutes } from "../../src/limits/routes.js";
import { RunSlots } from "../../src/limits/slots.js";
import { UsageRepoError } from "../../src/limits/usageRepo.js";
import { CHAT_1 } from "../fixtures/users.js";
import { FakeUsageStore } from "./fakeUsage.js";

const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const LIMITS: Limits = { runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 };

function setup(human: HumanCheckGate = { state: async () => "off" }) {
  const clock = { now: T0 };
  const now = () => clock.now;
  const store = new FakeUsageStore(() => new Date(clock.now));
  const repo = store.repo({ caps: { perMonth: LIMITS.perMonth, perHour: LIMITS.perHour } });
  const limiter = new RateLimiter({ now });
  const policy = new HostedRunPolicy({
    limits: LIMITS,
    usage: repo,
    slots: new RunSlots({ staleAfterMs: 340_000, now }),
    humanCheck: human,
    limiter,
    now,
  });
  const alice: Principal = { ...store.newUser(), capabilities: NO_CAPABILITIES };
  const app = new Hono<AuthEnv>();
  app.use(async (c, next) => {
    c.set("user", alice);
    await next();
  });
  app.route("/", usageRoutes({ usage: repo, policy, limits: LIMITS, humanCheck: human, limiter, now }));
  return { clock, store, repo, policy, alice, app, get: () => app.request("/usage") };
}

afterEach(() => vi.restoreAllMocks());

describe("GET /usage", () => {
  it("shows the month, the hour, the running count and the human check", async () => {
    const s = setup();
    const t = await s.policy.admit({ principal: s.alice, chatId: CHAT_1, runId: "r1" });
    s.clock.now += 60_000;
    const res = await s.get();
    expect(res.status).toBe(200);
    expect((await res.json()) as UsageView).toEqual({
      month: { used: 1, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" },
      hour: { used: 1, limit: 10, resetsAt: new Date(T0 + 3_600_000).toISOString() },
      running: { mine: 1, limit: 1 },
      humanCheck: "off",
    });
    if (t.ok) t.ticket.end();
  });

  it("shows no hourly reset while the hour is empty", async () => {
    const s = setup();
    expect(await (await s.get()).json()).toEqual({
      month: { used: 0, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" },
      hour: { used: 0, limit: 10, resetsAt: null },
      running: { mine: 0, limit: 1 },
      humanCheck: "off",
    });
  });

  it.each<[HumanCheckState | "throws", HumanCheckState]>([
    ["required", "required"],
    ["done", "done"],
    ["unavailable", "unavailable"],
    ["throws", "unavailable"],
  ])("reports the human check as %s → %s", async (state, shown) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup({ state: async () => (state === "throws" ? Promise.reject(new Error("down")) : state) });
    expect(((await (await s.get()).json()) as UsageView).humanCheck).toBe(shown);
  });

  it("answers 503 usage_unavailable with retry-after when the database fails, never stale numbers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup();
    s.repo.failWith = new UsageRepoError("get", "timeout");
    const res = await s.get();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({
      error: "usage_unavailable",
      message: "Can't check your usage right now. Try again in a minute.",
    });
  });

  it("limits the route to 120 calls per 10 minutes per user", async () => {
    const s = setup();
    for (let i = 0; i < 120; i++) expect((await s.get()).status).toBe(200);
    const res = await s.get();
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    expect(s.repo.calls).toBe(120);
  });
});
