import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectSlots } from "../../src/copilot/owners.js";
import { withHeartbeat } from "../../src/copilot/sseHeartbeat.js";
import { ALICE, BOB } from "../fixtures/users.js";
import {
  CONNECT,
  type CopilotHarness,
  copilotHarness,
  Deferred,
  fakeRun,
  post,
  RUN,
  readUntil,
  runBody,
  T1,
  T2,
  T3,
  waitFor,
} from "./harness.js";

describe("ConnectSlots", () => {
  it("frees exactly one slot when a release runs twice", () => {
    const slots = new ConnectSlots(2);
    const first = slots.acquire(ALICE.id)!;
    const second = slots.acquire(ALICE.id)!;
    expect(slots.acquire(ALICE.id)).toBeUndefined();
    first();
    first();
    expect(slots.count(ALICE.id)).toBe(1);
    expect(slots.acquire(ALICE.id)).toBeDefined();
    expect(slots.acquire(ALICE.id)).toBeUndefined();
    second();
    expect(slots.count(ALICE.id)).toBe(1);
    expect(slots.acquire(BOB.id)).toBeDefined();
  });

  it("releases when the upstream stream errors", async () => {
    const slots = new ConnectSlots(1);
    const release = slots.acquire(ALICE.id)!;
    const source = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error("runtime failed"));
      },
    });
    const reader = withHeartbeat(source, { intervalMs: 15_000, onClose: release }).getReader();
    await expect(reader.read()).rejects.toThrow("runtime failed");
    expect(slots.count(ALICE.id)).toBe(0);
  });
});

describe("connect slots through the route", () => {
  let holds: Map<string, Deferred>;
  let quiet: Array<{ mockRestore(): void }> = [];
  beforeEach(() => {
    holds = new Map();
    quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
  });
  afterEach(() => {
    for (const d of holds.values()) d.resolve();
    for (const q of quiet) q.mockRestore();
    vi.useRealTimers();
  });

  async function liveRun(h: CopilotHarness, user = ALICE, threadId = T1) {
    holds.set(threadId, new Deferred());
    const reader = (await post(h, user, RUN, runBody(threadId))).body!.getReader();
    await readUntil(reader, (t) => t.includes("Hello"));
    return reader;
  }

  const ninthAccepted = async (h: CopilotHarness, threadId: string) => {
    await waitFor(() => h.slots.count(ALICE.id) === 0);
    const res = await post(h, ALICE, CONNECT, runBody(threadId));
    expect(res.status).toBe(200);
    await res.body?.cancel();
    await waitFor(() => h.slots.count(ALICE.id) === 0);
  };

  it("accepts a 9th connect after 8 that were cancelled", async () => {
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    await liveRun(h);
    for (let i = 0; i < 8; i++) {
      const res = await post(h, ALICE, CONNECT, runBody(T1));
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      await readUntil(reader, (t) => t.includes("Hello"));
      await reader.cancel();
    }
    await ninthAccepted(h, T1);
  });

  it("accepts a 9th connect after 8 refused with 403 or 400", async () => {
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    await liveRun(h, BOB, T2);
    for (let i = 0; i < 8; i++) {
      const res = await post(h, ALICE, CONNECT, i % 2 ? runBody(T2) : runBody("nope"));
      expect(res.status).toBe(i % 2 ? 403 : 400);
      await res.text();
    }
    await h.db.forUser(ALICE.id).chats.claim(T3, {});
    await ninthAccepted(h, T3);
  });

  it("accepts a 9th connect after 8 that ended, and counts back to 0 after each kind of end", async () => {
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    await h.db.forUser(ALICE.id).chats.claim(T3, {});
    for (let i = 0; i < 8; i++) {
      const res = await post(h, ALICE, CONNECT, runBody(T3));
      expect(res.status).toBe(200);
      await res.text();
    }
    expect(h.slots.count(ALICE.id)).toBe(0);
    await ninthAccepted(h, T3);

    const run = await liveRun(h);
    const joined = await post(h, ALICE, CONNECT, runBody(T1));
    const reader = joined.body!.getReader();
    await readUntil(reader, (t) => t.includes("Hello"));
    expect(h.slots.count(ALICE.id)).toBe(1);
    holds.get(T1)!.resolve();
    expect(await readUntil(reader, () => false)).toContain("RUN_FINISHED");
    await readUntil(run, () => false);
    await waitFor(() => h.slots.count(ALICE.id) === 0);
  });

  it("closes and releases a connect still open at the maximum duration", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = await copilotHarness({ handle: fakeRun({ holds }), connectMaxMs: 60_000 });
    holds.set(T1, new Deferred());
    const run = await post(h, ALICE, RUN, runBody(T1));
    const runReader = run.body!.getReader();
    await readUntil(runReader, (t) => t.includes("Hello"));
    const joined = (await post(h, ALICE, CONNECT, runBody(T1))).body!.getReader();
    await readUntil(joined, (t) => t.includes("Hello"));
    expect(h.slots.count(ALICE.id)).toBe(1);
    vi.advanceTimersByTime(59_000);
    await new Promise((r) => setImmediate(r));
    expect(h.slots.count(ALICE.id)).toBe(1);
    vi.advanceTimersByTime(1_000);
    expect(await joined.read()).toEqual({ done: true, value: undefined });
    expect(h.slots.count(ALICE.id)).toBe(0);
    holds.get(T1)!.resolve();
    expect(await readUntil(runReader, () => false)).toContain("RUN_FINISHED");
  });
});
