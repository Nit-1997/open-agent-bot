import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreRunAgent } from "../../src/copilot/coreRunAgent.js";
import { ALICE, BOB } from "../fixtures/users.js";
import {
  CountingGate,
  copilotHarness,
  Deferred,
  fakeRun,
  type Handle,
  parseSse,
  post,
  RUN,
  readUntil,
  runBody,
  started,
  settle,
  T1,
  T2,
  textStart,
  waitFor,
} from "./harness.js";

let holds: Map<string, Deferred>;
let quiet: Array<{ mockRestore(): void }> = [];
beforeEach(() => {
  holds = new Map();
  quiet = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
});
afterEach(() => {
  for (const d of holds.values()) d.resolve();
  for (const q of quiet) q.mockRestore();
});

const inputFor = (threadId: string) => runBody(threadId) as RunAgentInput;

async function agentFor(handle: Handle) {
  const gate = new CountingGate(8);
  const h = await copilotHarness({ handle, gate });
  const agent = h.deps.copilot!.agent(ALICE) as CoreRunAgent;
  return { h, gate, agent };
}

describe("run lifecycle through CoreRunAgent", () => {
  it("ends the run when the runner unsubscribes mid-stream", async () => {
    holds.set(T1, new Deferred());
    const { gate, agent } = await agentFor(fakeRun({ holds }));
    const events: BaseEvent[] = [];
    const sub = agent.run(inputFor(T1)).subscribe({ next: (e) => events.push(e) });
    await waitFor(() => events.length >= 3);
    expect(gate.active).toBe(1);
    sub.unsubscribe();
    await waitFor(() => gate.active === 0);
  });

  it("ends the run with RUN_ERROR abort after abortRun()", async () => {
    holds.set(T1, new Deferred());
    const { gate, agent } = await agentFor(fakeRun({ holds }));
    const events: BaseEvent[] = [];
    const done = new Deferred();
    agent.run(inputFor(T1)).subscribe({ next: (e) => events.push(e), complete: () => done.resolve() });
    await waitFor(() => events.length >= 3);
    agent.abortRun();
    await done.promise;
    expect(events.at(-1)).toMatchObject({ type: "RUN_ERROR", code: "abort", message: "This operation was aborted" });
    expect(gate.active).toBe(0);
  });

  it("ends the run when handleRun throws", async () => {
    const throwing = async function* (input: RunAgentInput) {
      yield started(input);
      yield textStart("m1");
      throw new Error("handle failed");
    } as unknown as Handle;
    const { gate, agent } = await agentFor(throwing);
    const failed = new Deferred<unknown>();
    agent.run(inputFor(T1)).subscribe({ error: (e) => failed.resolve(e) });
    expect(await failed.promise).toMatchObject({ message: "handle failed" });
    expect(gate.active).toBe(0);
  });

  it("closes a startRun handle the consumer drops before reading it", async () => {
    const seen: Array<{ user: string; threadId: string }> = [];
    const { gate, agent } = await agentFor(fakeRun({ seen }));
    const sub = agent.run(inputFor(T1)).subscribe({});
    sub.unsubscribe();
    await settle(50);
    expect(gate.active).toBe(0);
    expect(seen).toEqual([]);
  });
});

describe("run lifecycle through the route", () => {
  it("keeps the run going when the client disconnects, until the run ends", async () => {
    holds.set(T1, new Deferred());
    const gate = new CountingGate(8);
    const h = await copilotHarness({ handle: fakeRun({ holds }), gate });
    const res = await post(h, ALICE, RUN, runBody(T1));
    const reader = res.body!.getReader();
    await readUntil(reader, (t) => t.includes("Hello"));
    await reader.cancel();
    await settle(50);
    expect(gate.active).toBe(1);
    holds.get(T1)!.resolve();
    await waitFor(() => gate.active === 0);
  });

  it("keeps each concurrent run on its own principal with no caller bleed", async () => {
    holds.set(T1, new Deferred());
    holds.set(T2, new Deferred());
    const seen: Array<{ user: string; threadId: string }> = [];
    const h = await copilotHarness({ handle: fakeRun({ holds, seen }) });
    const [a, b] = await Promise.all([post(h, ALICE, RUN, runBody(T1)), post(h, BOB, RUN, runBody(T2))]);
    const [ra, rb] = [a.body!.getReader(), b.body!.getReader()];
    const [ha, hb] = await Promise.all([readUntil(ra, (t) => t.includes("Hello")), readUntil(rb, (t) => t.includes("Hello"))]);
    await settle(5);
    holds.get(T2)!.resolve();
    await settle(5);
    holds.get(T1)!.resolve();
    const rest = await Promise.all([readUntil(ra, () => false), readUntil(rb, () => false)]);
    const [ta, tb] = [ha + rest[0], hb + rest[1]];
    expect(seen).toEqual(
      expect.arrayContaining([
        { user: ALICE.id, threadId: T1 },
        { user: BOB.id, threadId: T2 },
      ]),
    );
    expect(seen).toHaveLength(2);
    expect(h.contexts.map((c) => c.user.id).sort()).toEqual([ALICE.id, BOB.id].sort());
    expect(await h.db.forUser(ALICE.id).chats.exists(T1)).toBe(true);
    expect(await h.db.forUser(BOB.id).chats.exists(T2)).toBe(true);
    expect(await h.db.forUser(ALICE.id).chats.exists(T2)).toBe(false);
    expect(h.owners.ownerOf(T1)).toBe(ALICE.id);
    expect(h.owners.ownerOf(T2)).toBe(BOB.id);
    const deltas = (text: string) =>
      parseSse(text)
        .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
        .map((e) => e.delta as string);
    expect(deltas(ta).join("")).toContain(ALICE.id);
    expect(deltas(ta).join("")).not.toContain(BOB.id);
    expect(deltas(tb).join("")).toContain(BOB.id);
    expect(deltas(tb).join("")).not.toContain(ALICE.id);
    for (const e of parseSse(ta).filter((x) => x.threadId)) expect(e.threadId).toBe(T1);
    for (const e of parseSse(tb).filter((x) => x.threadId)) expect(e.threadId).toBe(T2);
  });

  it("builds a new CoreRunAgent for every request and never reuses one", async () => {
    const h = await copilotHarness({ handle: fakeRun() });
    await (await h.call(ALICE, "/copilotkit/info")).text();
    await (await post(h, ALICE, RUN, runBody(T1))).text();
    await (await post(h, BOB, RUN, runBody(T2))).text();
    await (await post(h, ALICE, RUN, runBody(T1))).text();
    expect(h.agents.length).toBeGreaterThanOrEqual(4);
    expect(new Set(h.agents).size).toBe(h.agents.length);
    for (const a of h.agents) expect(a).toBeInstanceOf(CoreRunAgent);
    const factory = h.deps.copilot!.agent;
    expect(factory(ALICE)).not.toBe(factory(ALICE));
  });
});
