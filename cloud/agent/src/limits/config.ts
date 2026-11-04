import type { Limit } from "@oab/core/lib/rateLimit.js";
import type { Limits } from "@oab/shared/usage";

type Range = { key: keyof Limits; fallback: number; min: number; max: number };

export const LIMIT_RANGES = {
  LIMIT_RUNNING_PER_USER: { key: "runningPerUser", fallback: 1, min: 1, max: 10 },
  LIMIT_REQUESTS_PER_HOUR: { key: "perHour", fallback: 10, min: 1, max: 1000 },
  LIMIT_REQUESTS_PER_MONTH: { key: "perMonth", fallback: 50, min: 1, max: 100000 },
  LIMIT_RUNNING_SERVER: { key: "runningServer", fallback: 8, min: 1, max: 200 },
} as const satisfies Record<string, Range>;

export const BUSY_RETRY_S = 60;
export const RUNNING_RETRY_S = 5;
export const UNAVAILABLE_RETRY_S = 60;
export const STALE_GRACE_S = 60;
export const SWEEP_MS = 30_000;
export const PRUNE_MS = 60 * 60_000;

export const ADMIT_ATTEMPTS: Limit = { max: 60, windowMs: 10 * 60_000 };
export const USAGE_ROUTE: Limit = { max: 120, windowMs: 10 * 60_000 };

export function limitsFrom(env: NodeJS.ProcessEnv, problems: string[]): Limits {
  const limits = {} as Limits;
  for (const [name, r] of Object.entries(LIMIT_RANGES) as [string, Range][]) {
    const raw = env[name]?.trim();
    const n = raw ? Number(raw) : r.fallback;
    if (!raw || (/^\d+$/.test(raw) && n >= r.min && n <= r.max)) limits[r.key] = n;
    else {
      problems.push(`${name} must be a whole number from ${r.min} to ${r.max}`);
      limits[r.key] = r.fallback;
    }
  }
  if (limits.runningServer < limits.runningPerUser) problems.push("LIMIT_RUNNING_SERVER must be at least LIMIT_RUNNING_PER_USER");
  return limits;
}

export const limitsLine = (l: Limits) =>
  `[limits] running/user=${l.runningPerUser} hour=${l.perHour} month=${l.perMonth} running/server=${l.runningServer}`;
