import { UserError } from "./errors.js";

export type Limit = { max: number; windowMs: number };
export type Verdict = { ok: true } | { ok: false; retryAfter: number };

export const LIMITS = {
  run: { max: 30, windowMs: 10 * 60_000 },
  keys: { max: 20, windowMs: 60 * 60_000 },
  login: { max: 5, windowMs: 10 * 60_000 },
  profile: { max: 60, windowMs: 60 * 60_000 },
  places: { max: 120, windowMs: 10 * 60_000 },
  options: { max: 120, windowMs: 10 * 60_000 },
  chats: { max: 120, windowMs: 10 * 60_000 },
  lists: { max: 240, windowMs: 10 * 60_000 },
  search: { max: 300, windowMs: 10 * 60_000 },
  admin: { max: 120, windowMs: 10 * 60_000 },
  emailLinkIp: { max: 5, windowMs: 60 * 60_000 },
  emailLinkAddr: { max: 3, windowMs: 60 * 60_000 },
} as const satisfies Record<string, Limit>;

export const RUN_CONCURRENCY = 2;

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  take(key: string, limit: Limit): Verdict {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < limit.windowMs);
    if (recent.length >= limit.max) {
      this.hits.set(key, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + limit.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { ok: true };
  }

  sweep(maxWindowMs = 60 * 60_000): void {
    const now = this.now();
    for (const [key, times] of this.hits) if (!times.some((t) => now - t < maxWindowMs)) this.hits.delete(key);
  }
}

export class ConcurrencyGate {
  private readonly running = new Map<string, number>();

  constructor(private readonly max: number) {}

  enter(key: string): (() => void) | undefined {
    const n = this.running.get(key) ?? 0;
    if (n >= this.max) return undefined;
    this.running.set(key, n + 1);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const now = (this.running.get(key) ?? 1) - 1;
      if (now <= 0) this.running.delete(key);
      else this.running.set(key, now);
    };
  }
}

export const rateLimitError = (retryAfter: number) =>
  new UserError(`Slow down: try again in ${retryAfter} s.`, "rate_limited", { retryAfter });
