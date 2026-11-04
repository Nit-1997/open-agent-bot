import type { Health, HealthClient } from "./health.ts";
import type { Log } from "./logger.ts";

export type StopReason =
  | { kind: "docker_stopped" }
  | { kind: "refused"; code: string; exitCode: number; line: string }
  | { kind: "crashed"; exitCode: number }
  | { kind: "unhealthy" }
  | { kind: "missing" }
  | { kind: "healthy" };

export type Watchdog = Readonly<{ start(): void; stop(): void; running(): boolean }>;

export type WatchdogDeps = Readonly<{
  health: HealthClient;
  port: () => number | undefined;
  good: (h: Health | undefined) => boolean;
  probe: () => Promise<StopReason>;
  onFirstFailure: () => Promise<void> | void;
  onRecovered: () => Promise<boolean> | boolean;
  onStopped: (r: StopReason) => void;
  log?: Log;
  intervalMs?: number;
  failures?: number;
  timeoutMs?: number;
  schedule?: (f: () => void, ms: number) => () => void;
}>;

const defaultSchedule = (f: () => void, ms: number) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createWatchdog(d: WatchdogDeps): Watchdog & { tick(): Promise<void> } {
  const interval = d.intervalMs ?? 10_000;
  const limit = d.failures ?? 3;
  const schedule = d.schedule ?? defaultSchedule;
  let failures = 0;
  let active = false;
  let gen = 0;
  let inflight: number | undefined;
  let cancel: (() => void) | undefined;

  const health = async (): Promise<Health | undefined> => {
    const port = d.port();
    if (port === undefined) return undefined;
    try {
      return await d.health.get(port, d.timeoutMs ?? 2000);
    } catch (e) {
      d.log?.warn(`[watchdog] tick failed health ${message(e)}`);
      return undefined;
    }
  };

  const step = async (g: number) => {
    const h = await health();
    if (g !== gen) return;
    if (d.good(h)) {
      if (failures > 0) {
        const ok = await d.onRecovered();
        if (g !== gen) return;
        failures = ok ? 0 : failures + 1;
      }
    } else {
      failures += 1;
      if (failures === 1) await d.onFirstFailure();
      if (g !== gen) return;
    }
    if (failures < limit) return;
    const r = await d.probe();
    if (g !== gen) return;
    if (r.kind === "healthy") {
      failures = limit - 1;
      return;
    }
    active = false;
    d.onStopped(r);
  };

  const tick = async () => {
    const g = gen;
    if (!active || inflight === g) return;
    inflight = g;
    try {
      await step(g);
    } catch (e) {
      if (g === gen) d.log?.warn(`[watchdog] tick failed ${message(e)}`);
    } finally {
      if (inflight === g) inflight = undefined;
    }
    if (!active || g !== gen) return;
    cancel?.();
    cancel = schedule(() => void tick(), interval);
  };

  return {
    start: () => {
      if (active) return;
      gen += 1;
      active = true;
      failures = 0;
      cancel?.();
      cancel = schedule(() => void tick(), interval);
    },
    stop: () => {
      gen += 1;
      active = false;
      cancel?.();
      cancel = undefined;
    },
    running: () => active,
    tick,
  };
}
