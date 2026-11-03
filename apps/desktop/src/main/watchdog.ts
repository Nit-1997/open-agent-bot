import type { Health, HealthClient } from "./health.ts";

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
  intervalMs?: number;
  failures?: number;
  timeoutMs?: number;
  schedule?: (f: () => void, ms: number) => () => void;
}>;

const defaultSchedule = (f: () => void, ms: number) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

export function createWatchdog(d: WatchdogDeps): Watchdog & { tick(): Promise<void> } {
  const interval = d.intervalMs ?? 10_000;
  const limit = d.failures ?? 3;
  const schedule = d.schedule ?? defaultSchedule;
  let failures = 0;
  let active = false;
  let cancel: (() => void) | undefined;
  let busy = false;

  const tick = async () => {
    if (!active || busy) return;
    busy = true;
    try {
      const port = d.port();
      const h = port === undefined ? undefined : await d.health.get(port, d.timeoutMs ?? 2000);
      if (!active) return;
      if (d.good(h)) {
        if (failures > 0) {
          const ok = await d.onRecovered();
          if (ok) failures = 0;
          else failures += 1;
        }
      } else {
        failures += 1;
        if (failures === 1) await d.onFirstFailure();
      }
      if (failures >= limit) {
        const r = await d.probe();
        if (!active) return;
        if (r.kind === "healthy") {
          failures = limit - 1;
        } else {
          active = false;
          d.onStopped(r);
          return;
        }
      }
    } finally {
      busy = false;
    }
    if (active) cancel = schedule(() => void tick(), interval);
  };

  return {
    start: () => {
      if (active) return;
      active = true;
      failures = 0;
      cancel = schedule(() => void tick(), interval);
    },
    stop: () => {
      active = false;
      cancel?.();
      cancel = undefined;
    },
    running: () => active,
    tick,
  };
}
