import type { Log } from "./logger.ts";
import { readStateFile, writeStateFile } from "./statePaths.ts";
import { obj } from "../shared/util.ts";

export type PendingDelete = Readonly<{ project: string; dataVolume: string; keysVolume: string; at: string }>;

export type Settings = Readonly<{
  schema: 1;
  stopOnQuit: boolean;
  checkForUpdates: boolean;
  lastUpdateCheck?: string;
  dismissedVersion?: string;
  keepOutsideApplications?: boolean;
  pendingDelete?: PendingDelete;
  partials?: readonly string[];
}>;

export const DEFAULT_SETTINGS: Settings = { schema: 1, stopOnQuit: true, checkForUpdates: true };

const NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

function parsePending(v: unknown): PendingDelete | undefined {
  const r = obj(v);
  if (!r) return undefined;
  const { project, dataVolume, keysVolume, at } = r;
  if (typeof project !== "string" || typeof dataVolume !== "string" || typeof keysVolume !== "string" || typeof at !== "string")
    return undefined;
  if (![project, dataVolume, keysVolume].every((n) => NAME.test(n))) return undefined;
  return { project, dataVolume, keysVolume, at };
}

export function parseSettings(v: unknown): Settings | undefined {
  const r = obj(v);
  if (r?.schema !== 1 || typeof r.stopOnQuit !== "boolean" || typeof r.checkForUpdates !== "boolean") return undefined;
  const pendingDelete = r.pendingDelete === undefined ? undefined : parsePending(r.pendingDelete);
  if (r.pendingDelete !== undefined && !pendingDelete) return undefined;
  const partials = Array.isArray(r.partials)
    ? r.partials.filter((p): p is string => typeof p === "string" && p.endsWith(".partial"))
    : undefined;
  return {
    schema: 1,
    stopOnQuit: r.stopOnQuit,
    checkForUpdates: r.checkForUpdates,
    ...(typeof r.lastUpdateCheck === "string" ? { lastUpdateCheck: r.lastUpdateCheck } : {}),
    ...(typeof r.dismissedVersion === "string" ? { dismissedVersion: r.dismissedVersion } : {}),
    ...(r.keepOutsideApplications === true ? { keepOutsideApplications: true } : {}),
    ...(pendingDelete ? { pendingDelete } : {}),
    ...(partials && partials.length > 0 ? { partials } : {}),
  };
}

export type SettingsStore = Readonly<{
  get(): Settings;
  update(patch: Partial<Omit<Settings, "schema">>, drop?: readonly (keyof Settings)[]): Settings;
}>;

export function createSettingsStore(file: string, log: Log): SettingsStore {
  const read = readStateFile(file, parseSettings);
  let current: Settings = read.value ?? DEFAULT_SETTINGS;
  if (read.problem && read.problem !== "missing") {
    log.warn(`[state] settings.json ${read.problem}; defaults used and the file rewritten`);
    writeStateFile(file, current);
  }
  return {
    get: () => current,
    update: (patch, drop = []) => {
      const next: Record<string, unknown> = { ...current, ...patch, schema: 1 };
      for (const k of drop) delete next[k];
      current = next as Settings;
      writeStateFile(file, current);
      return current;
    },
  };
}
