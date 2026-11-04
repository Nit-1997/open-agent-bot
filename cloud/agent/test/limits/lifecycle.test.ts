import { EventType } from "@ag-ui/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunHandle, StartRunResult } from "@oab/core/agui/startRun.js";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { Limits } from "@oab/shared/usage";
import { drain, errorCodes, holdUntilAbort, pullUntil, runWorld, toolCallOf } from "../../../../packages/core/test/agui/runWorld.js";
import type { Script } from "../../../../packages/core/test/agui/fakeSession.js";
import { humanCheckOff } from "../../src/limits/humanCheckStub.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import { RunSlots } from "../../src/limits/slots.js";
import { CHAT_1, CHAT_2 } from "../fixtures/users.js";
import { FakeUsageStore } from "./fakeUsage.js";

const MONTH = "2026-11-01";

function hosted(script: Script, over: Partial<Limits> = {}) {
  const store = new FakeUsageStore(() => new Date("2026-11-04T10:00:00.000Z"));
  const limits: Limits = { runningPerUser: 1, perHour: 100, perMonth: 100, runningServer: 8, ...over };
  const usage = store.repo({ caps: { perMonth: limits.perMonth, perHour: limits.perHour } });
  const policy = new HostedRunPolicy({
    limits,
    usage,
    slots: new RunSlots({ staleAfterMs: 340_000 }),
    humanCheck: humanCheckOff,
    limiter: new RateLimiter(),
  });
  const world = runWorld({ policy, script });
  const user = (): Principal => ({ ...store.newUser(), capabilities: NO_CAPABILITIES });
  const count = (u: Principal) => store.monthCount(u.id, MONTH);
  return { store, usage, policy, world, user, count };
}

function runOf(r: StartRunResult): RunHandle {
  if (!r.ok) throw new Error(`refused: ${r.error.opts.code}`);
  return r.run;
}

const refusedWith = (r: StartRunResult) => (r.ok ? "ok" : r.error.opts.code);

afterEach(() => {
  vi.useRealTimers();
});

describe("hosted run lifecycle through startRun and handleRun", () => {
  it("keeps the user's slot while a stopped run finishes a 5 s tool call, then admits the next run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = hosted(toolCallOf(5000));
    const alice = h.user();
    const run = runOf(await h.world.start(alice, CHAT_1, "r1"));
    await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
    run.close();
    await vi.advanceTimersByTimeAsync(4000);
    expect(refusedWith(await h.world.start(alice, CHAT_2, "r2"))).toBe("limit_running");
    expect(h.policy.snapshot().runningOf(alice.id)).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.policy.snapshot().runningOf(alice.id)).toBe(0);
    const next = runOf(await h.world.start(alice, CHAT_2, "r3"));
    next.close();
    expect(h.count(alice)).toBe(2);
  });

  it("refuses the same runId in a second chat with limit_running while the first runs", async () => {
    const h = hosted(holdUntilAbort);
    const alice = h.user();
    const first = runOf(await h.world.start(alice, CHAT_1, "shared-run"));
    await pullUntil(first, EventType.TEXT_MESSAGE_CONTENT);
    expect(refusedWith(await h.world.start(alice, CHAT_2, "shared-run"))).toBe("limit_running");
    expect(h.count(alice)).toBe(1);
    first.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
  });

  it("leaves the count unchanged after an abort once the run started", async () => {
    const h = hosted(holdUntilAbort);
    const alice = h.user();
    const run = runOf(await h.world.start(alice, CHAT_1, "r1"));
    await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
    expect(h.count(alice)).toBe(1);
    run.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    expect(h.count(alice)).toBe(1);
    expect(h.usage.calls).toBe(1);
  });

  it("refunds a same-chat resend refused THREAD_BUSY after admission", async () => {
    const h = hosted(holdUntilAbort, { runningPerUser: 2 });
    const alice = h.user();
    const first = runOf(await h.world.start(alice, CHAT_1, "r1"));
    await pullUntil(first, EventType.TEXT_MESSAGE_CONTENT);
    const resend = runOf(await h.world.start(alice, CHAT_1, "r2"));
    expect(errorCodes(await drain(resend))).toEqual(["THREAD_BUSY"]);
    await vi.waitFor(() => expect(h.count(alice)).toBe(1));
    expect(h.policy.snapshot().runningOf(alice.id)).toBe(1);
    first.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    expect(h.count(alice)).toBe(1);
  });

  it("refunds a run whose client aborted before it started", async () => {
    const h = hosted(holdUntilAbort);
    const alice = h.user();
    const ac = new AbortController();
    ac.abort();
    runOf(await h.world.start(alice, CHAT_1, "r1", ac.signal));
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
    await vi.waitFor(() => expect(h.count(alice)).toBe(0));
  });

  it("never charges a policy refusal", async () => {
    const h = hosted(holdUntilAbort);
    const alice = h.user();
    const run = runOf(await h.world.start(alice, CHAT_1, "r1"));
    await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
    for (let i = 0; i < 5; i++) expect(refusedWith(await h.world.start(alice, CHAT_2, `x${i}`))).toBe("limit_running");
    expect(h.count(alice)).toBe(1);
    expect(h.usage.calls).toBe(1);
    run.close();
    await vi.waitFor(() => expect(h.policy.snapshot().running).toBe(0));
  });
});
