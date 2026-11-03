import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHeartbeat } from "../../src/copilot/sseHeartbeat.js";
import { ALICE } from "../fixtures/users.js";
import { CONNECT, copilotHarness, Deferred, fakeRun, post, RUN, readUntil, runBody, T1 } from "../copilot/harness.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

function controlledSource() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel,
  });
  return {
    source,
    cancel,
    push: (s: string) => controller.enqueue(enc.encode(s)),
    end: () => controller.close(),
    fail: (e: unknown) => controller.error(e),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("withHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings an idle stream every 15 s and never inside an event", async () => {
    const { source, push } = controlledSource();
    const reader = withHeartbeat(source, { intervalMs: 15_000 }).getReader();
    const chunks: string[] = [];
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        chunks.push(dec.decode(value));
      }
    })();
    vi.advanceTimersByTime(15_000);
    await flush();
    expect(chunks).toEqual([": ping\n\n"]);
    push('data: {"type":"TEXT_MESSAGE_CONTENT",');
    await flush();
    vi.advanceTimersByTime(45_000);
    await flush();
    push('"delta":"hi"}\n\n');
    await flush();
    vi.advanceTimersByTime(15_000);
    await flush();
    expect(chunks.join("")).toBe(': ping\n\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"hi"}\n\n: ping\n\n');
    await reader.cancel();
    await pump;
  });

  it("on downstream cancel clears its timers, cancels the upstream reader and writes nothing after", async () => {
    const baseline = vi.getTimerCount();
    const { source, cancel, push } = controlledSource();
    const onClose = vi.fn();
    const reader = withHeartbeat(source, { intervalMs: 15_000, maxMs: 60_000, onClose }).getReader();
    push("data: {}\n\n");
    await reader.read();
    expect(vi.getTimerCount()).toBe(baseline + 2);
    await reader.cancel("client left");
    expect(vi.getTimerCount()).toBe(baseline);
    expect(cancel).toHaveBeenCalledWith("client left");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(() => vi.advanceTimersByTime(120_000)).not.toThrow();
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears its timers when the upstream ends or errors", async () => {
    const baseline = vi.getTimerCount();
    const ended = controlledSource();
    const a = withHeartbeat(ended.source, { intervalMs: 15_000 }).getReader();
    ended.end();
    expect(await a.read()).toEqual({ done: true, value: undefined });
    expect(vi.getTimerCount()).toBe(baseline);
    const failed = controlledSource();
    const b = withHeartbeat(failed.source, { intervalMs: 15_000 }).getReader();
    failed.fail(new Error("upstream broke"));
    await expect(b.read()).rejects.toThrow("upstream broke");
    expect(vi.getTimerCount()).toBe(baseline);
  });
});

describe("copilotkit stream heartbeat", () => {
  let holds: Map<string, Deferred>;
  beforeEach(() => {
    holds = new Map([[T1, new Deferred()]]);
  });
  afterEach(() => {
    for (const d of holds.values()) d.resolve();
    vi.useRealTimers();
  });

  it("pings an idle run and an idle connect after 15 s", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    const run = (await post(h, ALICE, RUN, runBody(T1))).body!.getReader();
    await readUntil(run, (t) => t.includes("Hello"));
    const connect = (await post(h, ALICE, CONNECT, runBody(T1))).body!.getReader();
    await readUntil(connect, (t) => t.includes("Hello"));
    vi.advanceTimersByTime(15_000);
    expect(await readUntil(run, (t) => t.includes(": ping"))).toBe(": ping\n\n");
    expect(await readUntil(connect, (t) => t.includes(": ping"))).toBe(": ping\n\n");
    holds.get(T1)!.resolve();
    expect(await readUntil(run, () => false)).toContain("RUN_FINISHED");
    expect(await readUntil(connect, () => false)).toContain("RUN_FINISHED");
  });
});
