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

  it("a wrong app on the port counts as a failure", async () => {
    const { w, events } = setup([{ ok: true, app: "other" }]);
    await w.tick();
    expect(events).toEqual(["close"]);
  });
});
