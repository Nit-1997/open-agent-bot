import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { SignupMode } from "@oab/shared/usage";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { RunSlots } from "../../src/limits/slots.js";
import { UsageRepoError } from "../../src/limits/usageRepo.js";
import { gateApplies, type HumanChecks, LiveHumanCheckGate } from "../../src/signup/humanCheck.js";
import { FakeUsageStore } from "../limits/fakeUsage.js";
import { TEST_LIMITS } from "../fixtures/usage.js";
import { CHAT_1 } from "../fixtures/users.js";

afterEach(() => vi.restoreAllMocks());

function checks(initial: string[] = []) {
  const done = new Set(initial);
  const c = {
    gets: 0,
    fail: undefined as Error | undefined,
    get: async (id: string) => {
      c.gets++;
      if (c.fail) throw c.fail;
      return done.has(id);
    },
    set: async (id: string) => {
      if (c.fail) throw c.fail;
      done.add(id);
    },
  };
  return c satisfies HumanChecks;
}

const gate = (mode: SignupMode | "unknown", c = checks(), verifierConfigured = true, maxRemembered?: number) =>
  new LiveHumanCheckGate({ mode: async () => mode, checks: c, verifierConfigured, ...(maxRemembered && { maxRemembered }) });

describe("LiveHumanCheckGate", () => {
  it("is off in invite and waitlist without a database call", async () => {
    for (const mode of ["invite", "waitlist"] as const) {
      const c = checks();
      expect(await gate(mode, c).state("u1")).toBe("off");
      expect(c.gets).toBe(0);
    }
  });

  it("requires the check in open and when the mode is unknown (never fails open)", async () => {
    expect(await gate("open").state("u1")).toBe("required");
    expect(await gate("unknown").state("u1")).toBe("required");
    expect(gateApplies("unknown")).toBe(true);
    expect(gateApplies("waitlist")).toBe(false);
  });

  it("answers unavailable when the check is needed and Turnstile isn't configured", async () => {
    expect(await gate("open", checks(), false).state("u1")).toBe("unavailable");
    expect(await gate("unknown", checks(), false).state("u1")).toBe("unavailable");
  });

  it("answers done for a stored check even without Turnstile, and remembers it in memory", async () => {
    const c = checks(["u1"]);
    const g = gate("open", c, false);
    expect(await g.state("u1")).toBe("done");
    expect(await g.state("u1")).toBe("done");
    expect(c.gets).toBe(1);
  });

  it("answers unavailable on a lookup error, logs it and caches nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = checks(["u1"]);
    c.fail = new UsageRepoError("humanCheck.get", "timeout");
    const g = gate("open", c);
    expect(await g.state("u1")).toBe("unavailable");
    c.fail = undefined;
    expect(await g.state("u1")).toBe("done");
    expect(warn.mock.calls.flat().join(" ")).toContain("human check lookup failed user=u1");
  });

  it("confirm stores the check and remembers it; a failed save remembers nothing", async () => {
    const c = checks();
    const g = gate("open", c);
    c.fail = new Error("down");
    await expect(g.confirm("u1")).rejects.toThrow("down");
    c.fail = undefined;
    expect(await g.state("u1")).toBe("required");
    await g.confirm("u1");
    const before = c.gets;
    expect(await g.state("u1")).toBe("done");
    expect(c.gets).toBe(before);
  });

  it("forgets the oldest remembered user past the bound", async () => {
    const c = checks(["a", "b", "c"]);
    const g = gate("open", c, true, 2);
    for (const id of ["a", "b", "c"]) await g.state(id);
    const before = c.gets;
    await g.state("c");
    expect(c.gets).toBe(before);
    await g.state("a");
    expect(c.gets).toBe(before + 1);
  });
});

describe("HostedRunPolicy with the live gate", () => {
  const alice: Principal = { id: "00000000-0000-4000-8000-00000000000a", email: "alice@example.test", capabilities: NO_CAPABILITIES };

  function policy(mode: () => Promise<SignupMode | "unknown">, verifierConfigured = true) {
    const store = new FakeUsageStore();
    store.newUser(alice.email, alice.id);
    const usage = store.repo({ caps: { perMonth: 50, perHour: 10 } });
    const g = new LiveHumanCheckGate({ mode, checks: usage.humanCheck, verifierConfigured });
    const p = new HostedRunPolicy({
      limits: TEST_LIMITS,
      usage,
      slots: new RunSlots({ staleAfterMs: 340_000 }),
      humanCheck: g,
      limiter: new RateLimiter(),
    });
    return { p, g, usage };
  }
  const admit = (p: HostedRunPolicy) => p.admit({ principal: alice, chatId: CHAT_1, runId: "r1" });
  const codeOf = (a: Awaited<ReturnType<typeof admit>>) => (a.ok ? "ok" : a.error.opts.code);

  it("refuses human_check_required in open mode before any usage call, then admits after the check", async () => {
    const { p, g, usage } = policy(async () => "open");
    expect(codeOf(await admit(p))).toBe("human_check_required");
    const calls = usage.calls;
    await g.confirm(alice.id);
    const a = await admit(p);
    expect(codeOf(a)).toBe("ok");
    expect(usage.calls).toBeGreaterThan(calls);
    if (a.ok) a.ticket.end();
  });

  it("still requires the check when the mode lookup fails (unknown counts as open)", async () => {
    const { p } = policy(async () => "unknown");
    expect(codeOf(await admit(p))).toBe("human_check_required");
  });

  it("answers 503 human_check_unavailable on a check lookup error and without Turnstile", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = policy(async () => "open");
    broken.usage.failWith = new UsageRepoError("humanCheck.get", "timeout");
    const refused = await admit(broken.p);
    expect(refused.ok ? 0 : refused.error.kind).toBe("unavailable");
    expect(codeOf(refused)).toBe("human_check_unavailable");
    expect(codeOf(await admit(policy(async () => "open", false).p))).toBe("human_check_unavailable");
  });

  it("is invisible in waitlist mode", async () => {
    const { p } = policy(async () => "waitlist");
    const a = await admit(p);
    expect(codeOf(a)).toBe("ok");
    if (a.ok) a.ticket.end();
  });
});
