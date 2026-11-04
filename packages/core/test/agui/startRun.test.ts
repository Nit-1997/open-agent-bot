import { EventType } from "@ag-ui/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RunHandle, startRun } from "../../src/agui/startRun.js";
import { ConcurrencyGate, RateLimiter } from "../../src/lib/rateLimit.js";
import { LocalRunPolicy } from "../../src/policy/localRunPolicy.js";
import { ALICE, BOB, CHAT_1, CHAT_2 } from "../fixtures/users.js";
import { Deferred } from "../copilot/harness.js";
import { drain, errorCodes, flush, holdUntilAbort, pullUntil, RecordingPolicy, runInput, runWorld, toolCallOf } from "./runWorld.js";

function runOf(r: Awaited<ReturnType<typeof startRun>>): RunHandle {
  if (!r.ok) throw new Error(`refused: ${r.error.message}`);
  return r.run;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("startRun ticket lifecycle", () => {
  it("ends the ticket only after the run iterator settles, not when close() is called", async () => {
    const policy = new RecordingPolicy();
    const cleanup = new Deferred();
    const handle = async function* (_input: unknown, _ctx: unknown, _store: unknown, signal: AbortSignal) {
      yield { type: EventType.RUN_STARTED } as never;
      try {
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      } finally {
        await cleanup.promise;
      }
    };
    const world = runWorld({ policy });
    const run = runOf(await startRun({ ...world.deps, handle: handle as never }, ALICE, runInput(CHAT_1, "r1")));
    await run.events.next();
    const pending = run.events.next();
    run.close();
    await flush();
    expect(policy.tickets[0].end).not.toHaveBeenCalled();
    cleanup.resolve();
    await pending.catch(() => {});
    await vi.waitFor(() => expect(policy.tickets[0].end).toHaveBeenCalledTimes(1));
  });

  it("ends the ticket once when iteration completes naturally, and close() afterwards ends nothing more", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy });
    const run = runOf(await world.start(ALICE, CHAT_1, "r1"));
    const events = await drain(run);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(policy.tickets[0].end).toHaveBeenCalledTimes(1);
    run.close();
    await flush();
    expect(policy.tickets[0].end).toHaveBeenCalledTimes(1);
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
  });

  it("ends the ticket directly when the run context factory throws before events exist", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({
      policy,
      context: () => {
        throw new Error("context failed");
      },
    });
    await expect(world.start(ALICE, CHAT_1, "r1")).rejects.toThrow("context failed");
    expect(policy.tickets[0].end).toHaveBeenCalledTimes(1);
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
  });

  it("keeps a local gate slot taken while a stopped run finishes a 5 s tool call", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const policy = new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(1) });
    const world = runWorld({ policy, script: toolCallOf(5000) });
    const run = runOf(await world.start(ALICE, CHAT_1, "r1"));
    await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
    run.close();
    await vi.advanceTimersByTimeAsync(4000);
    const during = await policy.admit({ principal: ALICE, chatId: CHAT_2, runId: "r2" });
    expect(during.ok).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    const after = await policy.admit({ principal: ALICE, chatId: CHAT_2, runId: "r3" });
    expect(after.ok).toBe(true);
  });
});

describe("startRun refunds for pre-start refusals", () => {
  it("refunds a same-chat resend refused THREAD_BUSY and keeps the first run's charge", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy, script: holdUntilAbort });
    const first = runOf(await world.start(ALICE, CHAT_1, "r1"));
    await pullUntil(first, EventType.TEXT_MESSAGE_CONTENT);
    const second = runOf(await world.start(ALICE, CHAT_1, "r2"));
    expect(errorCodes(await drain(second))).toEqual(["THREAD_BUSY"]);
    expect(policy.tickets[1].refund).toHaveBeenCalledTimes(1);
    expect(policy.tickets[1].end).toHaveBeenCalledTimes(1);
    first.close();
    await vi.waitFor(() => expect(policy.tickets[0].end).toHaveBeenCalledTimes(1));
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
  });

  it("refunds a duplicate runId in the same chat", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy });
    await drain(runOf(await world.start(ALICE, CHAT_1, "r1")));
    const again = runOf(await world.start(ALICE, CHAT_1, "r1"));
    expect(errorCodes(await drain(again))).toEqual(["DUPLICATE_RUN"]);
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
    expect(policy.tickets[1].refund).toHaveBeenCalledTimes(1);
  });

  it("refunds a run refused BUSY because the agent is at session capacity", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy, script: holdUntilAbort, limits: { total: 1 } });
    const bob = runOf(await world.start(BOB, CHAT_2, "rb"));
    await pullUntil(bob, EventType.TEXT_MESSAGE_CONTENT);
    const alice = runOf(await world.start(ALICE, CHAT_1, "ra"));
    expect(errorCodes(await drain(alice))).toEqual(["BUSY"]);
    expect(policy.tickets[1].refund).toHaveBeenCalledTimes(1);
    bob.close();
    await vi.waitFor(() => expect(policy.tickets[0].end).toHaveBeenCalledTimes(1));
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
  });

  it("refunds a run whose signal aborted before it started", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy });
    const ac = new AbortController();
    ac.abort();
    runOf(await world.start(ALICE, CHAT_1, "r1", ac.signal));
    await vi.waitFor(() => expect(policy.tickets[0].end).toHaveBeenCalledTimes(1));
    expect(policy.tickets[0].refund).toHaveBeenCalledTimes(1);
  });

  it("never refunds an abort after the run started", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy, script: holdUntilAbort });
    const run = runOf(await world.start(ALICE, CHAT_1, "r1"));
    await pullUntil(run, EventType.TEXT_MESSAGE_CONTENT);
    run.close();
    await vi.waitFor(() => expect(policy.tickets[0].end).toHaveBeenCalledTimes(1));
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
  });

  it("keeps the charge for a run refused for bad input", async () => {
    const policy = new RecordingPolicy();
    const world = runWorld({ policy });
    const run = runOf(await startRun(world.deps, ALICE, runInput(CHAT_1, "r1", "   ")));
    expect(errorCodes(await drain(run))).toEqual(["BAD_INPUT"]);
    run.close();
    await flush();
    expect(policy.tickets[0].end).toHaveBeenCalledTimes(1);
    expect(policy.tickets[0].refund).not.toHaveBeenCalled();
  });

  it("works with a ticket that has no refund", async () => {
    const policy = new LocalRunPolicy({ limiter: new RateLimiter(), gate: new ConcurrencyGate(1) });
    const world = runWorld({ policy });
    await drain(runOf(await world.start(ALICE, CHAT_1, "r1")));
    const again = runOf(await world.start(ALICE, CHAT_1, "r1"));
    expect(errorCodes(await drain(again))).toEqual(["DUPLICATE_RUN"]);
    expect((await policy.admit({ principal: ALICE, chatId: CHAT_1, runId: "r2" })).ok).toBe(true);
  });
});
