import { describe, expect, it } from "vitest";
import type { Health } from "../src/main/health.ts";
import { isOpenAgent } from "../src/main/health.ts";
import { createWatchdog, type StopReason } from "../src/main/watchdog.ts";

function setup(results: (Health | undefined)[], probe: StopReason = { kind: "crashed", exitCode: 1 }) {
  const events: string[] = [];
  const queue = [...results];
  const w = createWatchdog({
    health: { get: async () => queue.shift() },
    port: () => 18421,
    good: isOpenAgent,
    probe: async () => {
      events.push("probe");
      return probe;
    },
    onFirstFailure: () => {
      events.push("close");
    },
    onRecovered: () => {
      events.push("reopen");
      return true;
    },
    onStopped: (r) => events.push(`stopped:${r.kind}`),
    schedule: () => () => {},
  });
  w.start();
  return { w, events };
}

const OK: Health = { ok: true, app: "open-agent", version: "1" };

describe("watchdog (D19)", () => {
  it("good health → no callbacks", async () => {
    const { w, events } = setup([OK, OK]);
    await w.tick();
    await w.tick();
    expect(events).toEqual([]);
  });

  it("the first failure closes the app origin; 2 failures → no probe; 3 → probe → stopped", async () => {
    const { w, events } = setup([undefined, undefined, undefined]);
    await w.tick();
    expect(events).toEqual(["close"]);
    await w.tick();
    expect(events).toEqual(["close"]);
    await w.tick();
    expect(events).toEqual(["close", "probe", "stopped:crashed"]);
    expect(w.running()).toBe(false);
  });

  it.each<StopReason>([
    { kind: "docker_stopped" },
    { kind: "refused", code: "kek_missing", exitCode: 82, line: "x" },
    { kind: "unhealthy" },
    { kind: "missing" },
  ])("reports $kind", async (r) => {
    const { w, events } = setup([undefined, undefined, undefined], r);
    for (let i = 0; i < 3; i++) await w.tick();
    expect(events.at(-1)).toBe(`stopped:${r.kind}`);
  });

  it("recovery reopens and resets the count", async () => {
    const { w, events } = setup([undefined, undefined, OK, undefined, undefined, OK]);
    for (let i = 0; i < 6; i++) await w.tick();
    expect(events).toEqual(["close", "reopen", "close", "reopen"]);
  });

  it("a throwing health check is logged, counts as a failure and the chain is rescheduled", async () => {
    const logged: string[] = [];
    const scheduled: number[] = [];
    let calls = 0;
    const events: string[] = [];
    const w = createWatchdog({
      health: {
        get: async () => {
          calls += 1;
          if (calls <= 3) throw new Error("boom");
          return undefined;
        },
      },
      port: () => 18421,
      good: isOpenAgent,
      probe: async () => {
        events.push("probe");
        return { kind: "crashed", exitCode: 1 };
      },
      onFirstFailure: () => {
        events.push("close");
      },
      onRecovered: () => true,
      onStopped: (r) => events.push(`stopped:${r.kind}`),
      log: { info: () => {}, warn: (m) => logged.push(m), error: (m) => logged.push(m) },
      schedule: (_f, ms) => {
        scheduled.push(ms);
        return () => {};
      },
    });
    w.start();
    await w.tick();
    expect(logged.some((l) => l.includes("[watchdog] tick failed") && l.includes("boom"))).toBe(true);
    expect(scheduled).toHaveLength(2);
    expect(w.running()).toBe(true);
    await w.tick();
    await w.tick();
    expect(events).toEqual(["close", "probe", "stopped:crashed"]);
  });

  it("a throwing probe is logged and the chain keeps running", async () => {
    const logged: string[] = [];
    const scheduled: number[] = [];
    const w = createWatchdog({
      health: { get: async () => undefined },
      port: () => 18421,
      good: isOpenAgent,
      probe: async () => {
        throw new Error("ps failed");
      },
      onFirstFailure: () => {},
      onRecovered: () => true,
      onStopped: () => {},
      failures: 1,
      log: { info: () => {}, warn: (m) => logged.push(m), error: (m) => logged.push(m) },
      schedule: (_f, ms) => {
        scheduled.push(ms);
        return () => {};
      },
    });
    w.start();
    await w.tick();
    expect(logged.some((l) => l.includes("ps failed"))).toBe(true);
    expect(w.running()).toBe(true);
    expect(scheduled).toHaveLength(2);
  });

  it("stop then start during an in-flight tick: the stale result is dropped and one timer chain remains", async () => {
    const events: string[] = [];
    const pending: ((h: Health | undefined) => void)[] = [];
    const timers: { f: () => void; cancelled: boolean }[] = [];
    const w = createWatchdog({
      health: { get: () => new Promise<Health | undefined>((r) => pending.push(r)) },
      port: () => 18421,
      good: isOpenAgent,
      probe: async () => ({ kind: "crashed", exitCode: 1 }),
      onFirstFailure: () => {
        events.push("close");
      },
      onRecovered: () => true,
      onStopped: (r) => events.push(`stopped:${r.kind}`),
      schedule: (f) => {
        const t = { f, cancelled: false };
        timers.push(t);
        return () => {
          t.cancelled = true;
        };
      },
    });
    w.start();
    const stale = w.tick();
    await Promise.resolve();
    w.stop();
    w.start();
    const fresh = w.tick();
    await Promise.resolve();
    expect(pending).toHaveLength(2);
    pending[0]!(undefined);
    await stale;
    expect(events).toEqual([]);
    pending[1]!(OK);
    await fresh;
    const live = timers.filter((t) => !t.cancelled);
    expect(live).toHaveLength(1);
    expect(timers[0]!.cancelled).toBe(true);
    expect(w.running()).toBe(true);
  });

  it("a wrong app on the port counts as a failure", async () => {
    const { w, events } = setup([{ ok: true, app: "other" }]);
    await w.tick();
    expect(events).toEqual(["close"]);
  });
});
