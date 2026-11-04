import { errorResponse } from "@oab/core/http/handlers.js";
import type { AuthEnv } from "@oab/core/identity/types.js";
import { log } from "@oab/core/lib/log.js";
import { type RateLimiter, rateLimitError } from "@oab/core/lib/rateLimit.js";
import { type HumanCheckState, type Limits, nextUtcMonth, type UsageView } from "@oab/shared/usage";
import { Hono } from "hono";
import { USAGE_ROUTE } from "./config.js";
import type { HumanCheckGate } from "./humanCheckStub.js";
import { type HostedRunPolicy, usageUnavailable } from "./policy.js";
import type { UsageRepo } from "./usageRepo.js";

export type UsageRouteDeps = {
  usage: Pick<UsageRepo, "get">;
  policy: Pick<HostedRunPolicy, "snapshot">;
  limits: Limits;
  humanCheck: HumanCheckGate;
  limiter: RateLimiter;
  now?: () => number;
};

export function usageRoutes(deps: UsageRouteDeps): Hono<AuthEnv> {
  const now = deps.now ?? Date.now;
  const app = new Hono<AuthEnv>();
  app.get("/usage", async (c) => {
    const user = c.get("user");
    const verdict = deps.limiter.take(`usage:${user.id}`, USAGE_ROUTE);
    if (!verdict.ok) return errorResponse(c, rateLimitError(verdict.retryAfter));
    let used: Awaited<ReturnType<UsageRepo["get"]>>;
    try {
      used = await deps.usage.get(user.id);
    } catch (err) {
      log.warn(`[limits] usage lookup failed user=${user.id}`, err instanceof Error ? err.message : err);
      return errorResponse(c, usageUnavailable(now()));
    }
    const humanCheck: HumanCheckState = await deps.humanCheck.state(user.id).catch((err: unknown) => {
      log.warn(`[limits] human check lookup failed user=${user.id}`, err instanceof Error ? err.message : err);
      return "unavailable" as const;
    });
    const view: UsageView = {
      month: { used: used.monthUsed, limit: deps.limits.perMonth, resetsAt: nextUtcMonth(now()).toISOString() },
      hour: { used: used.hourUsed, limit: deps.limits.perHour, resetsAt: used.hourRetryAt?.toISOString() ?? null },
      running: { mine: deps.policy.snapshot().runningOf(user.id), limit: deps.limits.runningPerUser },
      humanCheck,
    };
    return c.json(view);
  });
  return app;
}
