import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHUTDOWN_DEADLINE_MS, shutdownOnSignals } from "../../src/local/shutdown.js";

function harness() {
  const signals = new EventEmitter();
  const exits: number[] = [];
  const warnings: string[] = [];
  const shutdown = shutdownOnSignals({
    signals: signals as unknown as Pick<NodeJS.Process, "on">,
    exit: (code) => void exits.push(code),
    warn: (line) => void warnings.push(line),
  });
  return { signals, exits, warnings, shutdown };
}

const closable = (close: () => Promise<void> = async () => {}) => ({ close: vi.fn(close) });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("shutdownOnSignals", () => {
  it.each(["SIGTERM", "SIGINT"])("closes and exits 0 on %s once running", async (sig) => {
    const h = harness();
    const running = closable();
    h.shutdown.ready(running);
    h.signals.emit(sig);
    await vi.advanceTimersByTimeAsync(0);
    expect(running.close).toHaveBeenCalledTimes(1);
    expect(h.exits).toEqual([0]);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS * 2);
    expect(h.exits).toEqual([0]);
  });

  it("waits for startup when the signal comes first, then closes and exits 0", async () => {
    const h = harness();
    h.signals.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);
    expect(h.exits).toEqual([]);
    const running = closable();
    h.shutdown.ready(running);
    await vi.advanceTimersByTimeAsync(0);
    expect(running.close).toHaveBeenCalledTimes(1);
    expect(h.exits).toEqual([0]);
  });

  it("closes once however many signals arrive", async () => {
    const h = harness();
    const running = closable();
    h.shutdown.ready(running);
    h.signals.emit("SIGTERM");
    h.signals.emit("SIGINT");
    h.signals.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    expect(running.close).toHaveBeenCalledTimes(1);
    expect(h.exits).toEqual([0]);
  });

  it("does nothing until a signal arrives", async () => {
    const h = harness();
    const running = closable();
    h.shutdown.ready(running);
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS * 2);
    expect(running.close).not.toHaveBeenCalled();
    expect(h.exits).toEqual([]);
  });

  it("exits 1 with a warning when close fails", async () => {
    const h = harness();
    h.shutdown.ready(closable(async () => Promise.reject(new Error("disk gone"))));
    h.signals.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.exits).toEqual([1]);
    expect(h.warnings).toEqual(["[shutdown] close failed: disk gone"]);
  });

  it("exits 1 at the deadline when close hangs", async () => {
    const h = harness();
    h.shutdown.ready(closable(() => new Promise(() => {})));
    h.signals.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS - 1);
    expect(h.exits).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.exits).toEqual([1]);
    expect(h.warnings).toEqual([`[shutdown] SIGTERM: still closing after ${SHUTDOWN_DEADLINE_MS} ms, exiting`]);
  });

  it("exits 1 at the deadline when startup never finishes", async () => {
    const h = harness();
    h.signals.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS);
    expect(h.exits).toEqual([1]);
    expect(h.warnings).toEqual([`[shutdown] SIGINT: still starting after ${SHUTDOWN_DEADLINE_MS} ms, exiting`]);
  });
});
