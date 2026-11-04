import { UserError, type UserErrorKind } from "@oab/core/lib/errors.js";
import { log } from "@oab/core/lib/log.js";
import type { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { Admission, RunPolicy, RunRequest } from "@oab/core/policy/types.js";
import type { RunRefusalCode, RunRefusalWindow } from "@oab/shared/runRefusals";
import type { Limits } from "@oab/shared/usage";
import { ADMIT_ATTEMPTS, BUSY_RETRY_S, RUNNING_RETRY_S, UNAVAILABLE_RETRY_S } from "./config.js";
import type { HumanCheckGate } from "./humanCheckStub.js";
import type { RunSlots } from "./slots.js";
import { type AdmitResult, USAGE_TIMEOUT_MS, type UsageRepo } from "./usageRepo.js";

type RefusalParts = { retryAfter?: number; retryAt?: number; limit?: number; used?: number; window?: RunRefusalWindow };

const KIND: Record<RunRefusalCode, UserErrorKind> = {
  limit_running: "rate_limited",
  server_busy: "rate_limited",
  limit_hourly: "rate_limited",
  limit_attempts: "rate_limited",
  limit_monthly: "rate_limited",
  usage_unavailable: "unavailable",
  human_check_required: "forbidden",
  human_check_unavailable: "unavailable",
};

export function runRefusal(code: RunRefusalCode, message: string, parts: RefusalParts = {}): UserError {
  const details: Record<string, string | number> = {};
  if (parts.retryAt !== undefined) details.retryAt = new Date(parts.retryAt).toISOString();
  if (parts.limit !== undefined) details.limit = parts.limit;
  if (parts.used !== undefined) details.used = parts.used;
  if (parts.window !== undefined) details.window = parts.window;
  return new UserError(message, KIND[code], {
    code,
    ...(parts.retryAfter !== undefined && { retryAfter: parts.retryAfter }),
    ...(Object.keys(details).length > 0 && { details }),
  });
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export const slowDownMessage = (retryAfter: number) => `You're sending messages quickly. Try again in ${plural(retryAfter, "second")}.`;

export const runningMessage = (n: number) =>
  n === 1
    ? "You can run one chat at a time. Wait for the other one to finish or stop it."
    : `You can run ${n} chats at a time. Wait for one of the others to finish or stop it.`;

export const USAGE_UNAVAILABLE_MESSAGE = "Can't check your usage right now. Try again in a minute.";

export const usageUnavailable = (now: number) =>
  runRefusal("usage_unavailable", USAGE_UNAVAILABLE_MESSAGE, {
    retryAfter: UNAVAILABLE_RETRY_S,
    retryAt: now + UNAVAILABLE_RETRY_S * 1000,
  });

type Cached = { code: "limit_monthly" | "limit_hourly"; retryAt: number; limit: number; used: number };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("usage check timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export type HostedRunPolicyDeps = {
  limits: Limits;
  usage: UsageRepo;
  slots: RunSlots;
  humanCheck: HumanCheckGate;
  limiter: RateLimiter;
  now?: () => number;
};

export type PolicySnapshot = { running: number; staleReleased: number; runningOf(userId: string): number };

export class HostedRunPolicy implements RunPolicy {
  private readonly refused = new Map<string, Cached>();
  private readonly now: () => number;

  constructor(private readonly deps: HostedRunPolicyDeps) {
    this.now = deps.now ?? Date.now;
  }

  async admit(run: RunRequest): Promise<Admission> {
    const userId = run.principal.id;
    const attempt = this.deps.limiter.take(`admit:${userId}`, ADMIT_ATTEMPTS);
    if (!attempt.ok) {
      return this.refuse("limit_attempts", slowDownMessage(attempt.retryAfter), {
        retryAfter: attempt.retryAfter,
        retryAt: this.now() + attempt.retryAfter * 1000,
        limit: ADMIT_ATTEMPTS.max,
        window: "attempts",
      });
    }

    const cached = this.cachedRefusal(userId);
    if (cached) return { ok: false, error: cached };

    const human = await this.deps.humanCheck.state(userId).catch((err: unknown) => {
      log.warn(`[limits] human check lookup failed user=${userId}`, err instanceof Error ? err.message : err);
      return "unavailable" as const;
    });
    if (human === "required") return this.refuse("human_check_required", "Confirm you're human before your first message.");
    if (human === "unavailable") {
      return this.refuse("human_check_unavailable", "Sign-up checks are unavailable right now. Try again in a minute.", {
        retryAfter: UNAVAILABLE_RETRY_S,
        retryAt: this.now() + UNAVAILABLE_RETRY_S * 1000,
      });
    }

    const { limits, slots } = this.deps;
    const mine = slots.count(userId);
    if (mine >= limits.runningPerUser) {
      return this.refuse("limit_running", runningMessage(limits.runningPerUser), {
        retryAfter: RUNNING_RETRY_S,
        retryAt: this.now() + RUNNING_RETRY_S * 1000,
        limit: limits.runningPerUser,
        used: mine,
        window: "running",
      });
    }
    const all = slots.count();
    if (all >= limits.runningServer) {
      return this.refuse("server_busy", "The demo server is at capacity right now. Try again in a minute.", {
        retryAfter: BUSY_RETRY_S,
        retryAt: this.now() + BUSY_RETRY_S * 1000,
        limit: limits.runningServer,
        used: all,
        window: "server",
      });
    }
    const ticketId = slots.reserve(userId, run.runId);

    let result: AdmitResult;
    try {
      result = await withTimeout(this.deps.usage.admit(userId), USAGE_TIMEOUT_MS);
    } catch (err) {
      slots.release(ticketId);
      log.warn(`[limits] usage check failed user=${userId} run=${run.runId}`, err instanceof Error ? err.message : err);
      return { ok: false, error: usageUnavailable(this.now()) };
    }
    if (!result.ok) {
      slots.release(ticketId);
      const entry: Cached =
        result.reason === "month"
          ? { code: "limit_monthly", retryAt: result.retryAt.getTime(), limit: limits.perMonth, used: result.monthUsed }
          : { code: "limit_hourly", retryAt: result.retryAt.getTime(), limit: limits.perHour, used: result.hourUsed };
      this.refused.set(userId, entry);
      return { ok: false, error: this.fromCache(entry) };
    }

    const { logId } = result;
    let ended = false;
    let refunded = false;
    return {
      ok: true,
      ticket: {
        end: () => {
          if (ended) return;
          ended = true;
          slots.release(ticketId);
        },
        refund: () => {
          if (refunded) return;
          refunded = true;
          this.refused.delete(userId);
          void this.deps.usage
            .refund(userId, logId)
            .catch((err: unknown) =>
              log.warn(`[limits] refund failed user=${userId} run=${run.runId}`, err instanceof Error ? err.message : err),
            );
        },
      },
    };
  }

  sweep(): void {
    this.deps.slots.sweep();
    const now = this.now();
    for (const [userId, c] of [...this.refused]) if (c.retryAt <= now) this.refused.delete(userId);
  }

  snapshot(): PolicySnapshot {
    const { slots } = this.deps;
    return { running: slots.count(), staleReleased: slots.staleReleased, runningOf: (userId) => slots.count(userId) };
  }

  private refuse(code: RunRefusalCode, message: string, parts?: RefusalParts): Admission {
    return { ok: false, error: runRefusal(code, message, parts) };
  }

  private cachedRefusal(userId: string): UserError | undefined {
    const c = this.refused.get(userId);
    if (!c) return undefined;
    if (c.retryAt <= this.now()) {
      this.refused.delete(userId);
      return undefined;
    }
    return this.fromCache(c);
  }

  private fromCache(c: Cached): UserError {
    const retryAfter = Math.max(1, Math.ceil((c.retryAt - this.now()) / 1000));
    const message = c.code === "limit_monthly" ? `You've used this month's ${plural(c.limit, "request")}.` : slowDownMessage(retryAfter);
    return runRefusal(c.code, message, {
      retryAfter,
      retryAt: c.retryAt,
      limit: c.limit,
      used: c.used,
      window: c.code === "limit_monthly" ? "month" : "hour",
    });
  }
}
