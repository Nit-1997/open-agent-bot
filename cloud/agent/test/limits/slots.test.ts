import { describe, expect, it, vi } from "vitest";
import { RunSlots } from "../../src/limits/slots.js";

describe("RunSlots", () => {
  it("keys each slot by a fresh ticket id, so the same runId twice holds two slots", () => {
    const slots = new RunSlots({ staleAfterMs: 1000 });
    const a = slots.reserve("u1", "run-1");
    const b = slots.reserve("u1", "run-1");
    expect(a).not.toBe(b);
    expect(slots.count("u1")).toBe(2);
    expect(slots.count()).toBe(2);
    expect(slots.release(a)).toBe(true);
    expect(slots.count("u1")).toBe(1);
  });

  it("derives counts from the map, so a second release changes nothing", () => {
    const slots = new RunSlots({ staleAfterMs: 1000 });
    const a = slots.reserve("u1", "r");
    slots.reserve("u2", "r");
    expect(slots.release(a)).toBe(true);
    expect(slots.release(a)).toBe(false);
    expect(slots.count()).toBe(1);
    expect(slots.count("u1")).toBe(0);
    expect(slots.count("u2")).toBe(1);
  });

  it("force-releases slots older than the stale age with a log line and counts them", () => {
    let now = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slots = new RunSlots({ staleAfterMs: 340_000, now: () => now });
    const old = slots.reserve("u1", "run-old");
    now = 100_000;
    slots.reserve("u2", "run-new");
    now = 340_000;
    expect(slots.sweep()).toEqual([]);
    now = 340_001;
    expect(slots.sweep().map((s) => s.runId)).toEqual(["run-old"]);
    expect(slots.staleReleased).toBe(1);
    expect(slots.count()).toBe(1);
    expect(warn.mock.calls.flat().join(" ")).toContain("[limits] released a stale run slot user=u1 run=run-old age=340s");
    expect(slots.release(old)).toBe(false);
    expect(slots.count()).toBe(1);
    warn.mockRestore();
  });
});
