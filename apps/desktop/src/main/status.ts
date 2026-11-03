import type { ShellState } from "../shared/actions.ts";
import { writeStateFile } from "./statePaths.ts";

export type StatusFile = Readonly<{ screen: string; phase: string; port?: number; servicesVersion?: string; updatedAt: string }>;

export function statusOf(s: ShellState, servicesVersion: string | undefined, now: Date): StatusFile {
  return {
    screen: s.screen,
    phase: s.phase,
    ...(s.port === undefined ? {} : { port: s.port }),
    ...(servicesVersion ? { servicesVersion } : {}),
    updatedAt: now.toISOString(),
  };
}

export function createStatusWriter(file: string): (s: ShellState, servicesVersion: string | undefined) => void {
  let last = "";
  return (s, v) => {
    const key = `${s.screen}|${s.phase}|${s.port ?? ""}|${v ?? ""}`;
    if (key === last) return;
    last = key;
    writeStateFile(file, statusOf(s, v, new Date()));
  };
}
