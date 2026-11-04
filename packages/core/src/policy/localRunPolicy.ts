import { type ConcurrencyGate, LIMITS, type Limit, type RateLimiter, rateLimitError } from "../lib/rateLimit.js";
import type { Admission, RunPolicy, RunRequest } from "./types.js";

const GATE_RETRY_AFTER_S = 5;

export class LocalRunPolicy implements RunPolicy {
  constructor(private readonly deps: { limiter: RateLimiter; gate: ConcurrencyGate; limit?: Limit }) {}

  async admit(run: RunRequest): Promise<Admission> {
    const id = run.principal.id;
    const verdict = this.deps.limiter.take(`run:${id}`, this.deps.limit ?? LIMITS.run);
    if (!verdict.ok) return { ok: false, error: rateLimitError(verdict.retryAfter) };
    const leave = this.deps.gate.enter(id);
    if (!leave) return { ok: false, error: rateLimitError(GATE_RETRY_AFTER_S) };
    return { ok: true, ticket: { end: leave } };
  }
}
