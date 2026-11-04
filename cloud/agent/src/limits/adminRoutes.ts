import type { AuthEnv } from "@oab/core/identity/types.js";
import { pageParam, safe } from "@oab/core/http/handlers.js";
import { UserError } from "@oab/core/lib/errors.js";
import { log } from "@oab/core/lib/log.js";
import type { ProfileView } from "@oab/shared/admin";
import { normalizeId } from "@oab/shared/ids";
import { PAGE_SIZE, type PageResponse } from "@oab/shared/pages";
import {
  type AdminUsageDetail,
  type AdminUsageRow,
  type AdminUsageSummary,
  isUsageFilter,
  type Limits,
  nextUtcMonth,
  type SignupMode,
  USAGE_PAGE_MAX,
  USAGE_QUERY_MAX,
} from "@oab/shared/usage";
import { type Context, Hono } from "hono";
import type { HostedRunPolicy } from "./policy.js";
import type { UsagePageQuery, UsageRepo } from "./usageRepo.js";

export type AdminUsageDeps = {
  usage: Pick<UsageRepo, "summary" | "page" | "get" | "lastRequest">;
  policy: Pick<HostedRunPolicy, "snapshot">;
  limits: Limits;
  profiles: { get(id: string): Promise<ProfileView | undefined> };
  signupMode: () => Promise<SignupMode | "unknown">;
  now?: () => number;
};

export const ADMIN_USAGE_UNAVAILABLE = "Can't load usage right now. Try again in a minute.";

const invalid = (message: string) => new UserError(message, "invalid");

async function fromUsage<T>(where: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof UserError) throw err;
    log.warn(`[limits] admin usage ${where} failed`, err instanceof Error ? err.message : err);
    throw new UserError(ADMIN_USAGE_UNAVAILABLE, "unavailable", { code: "usage_unavailable", retryAfter: 60 });
  }
}

function pageOf(c: Context<AuthEnv>): number {
  const page = pageParam(c);
  if (page > USAGE_PAGE_MAX) throw invalid(`page must be a whole number from 1 to ${USAGE_PAGE_MAX}`);
  return page;
}

function queryOf(c: Context<AuthEnv>): string {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length > USAGE_QUERY_MAX) throw invalid(`q must be at most ${USAGE_QUERY_MAX} characters`);
  return q;
}

export function usageAdminRoutes(deps: AdminUsageDeps): Hono<AuthEnv> {
  const now = deps.now ?? Date.now;
  const app = new Hono<AuthEnv>();

  app.get(
    "/admin/usage/summary",
    safe<AuthEnv>(async (c) => {
      const totals = await fromUsage("summary", () => deps.usage.summary());
      const signupMode = await deps.signupMode().catch((err: unknown) => {
        log.warn("[limits] signup mode lookup failed", err instanceof Error ? err.message : err);
        return "unknown" as const;
      });
      const snap = deps.policy.snapshot();
      const view: AdminUsageSummary = {
        month: { total: totals.monthTotal, activeUsers: totals.activeUsers, resetsAt: nextUtcMonth(now()).toISOString() },
        running: { now: snap.running, limit: deps.limits.runningServer, staleReleased: snap.staleReleased },
        limits: deps.limits,
        signupMode,
        signups: null,
      };
      return c.json(view);
    }),
  );

  app.get(
    "/admin/usage/users",
    safe<AuthEnv>(async (c) => {
      const page = pageOf(c);
      const filter = c.req.query("filter") ?? "all";
      if (!isUsageFilter(filter)) throw invalid("filter must be all or at_limit");
      const q = queryOf(c);
      const query: UsagePageQuery = {
        ...(q && { query: q }),
        ...(filter === "at_limit" && { atLeast: deps.limits.perMonth }),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      const result = await fromUsage("page", () => deps.usage.page(query));
      const snap = deps.policy.snapshot();
      const body: PageResponse<AdminUsageRow> = {
        items: result.items.map((r) => ({
          id: r.userId,
          email: r.email,
          monthUsed: r.monthUsed,
          monthLimit: deps.limits.perMonth,
          lastAt: r.lastAt,
          runningNow: snap.runningOf(r.userId) > 0,
        })),
        total: result.total,
        page,
        pageSize: PAGE_SIZE,
      };
      return c.json(body);
    }),
  );

  app.get(
    "/admin/usage/users/:id",
    safe<AuthEnv>(async (c) => {
      const id = normalizeId(c.req.param("id"));
      if (!id) throw invalid("id must be a user id");
      const profile = await fromUsage("profile", () => deps.profiles.get(id));
      if (!profile) throw new UserError("That user doesn't exist.", "not_found");
      const [used, lastAt] = await fromUsage("detail", () => Promise.all([deps.usage.get(id), deps.usage.lastRequest(id)]));
      const detail: AdminUsageDetail = {
        id,
        email: profile.email,
        status: profile.status,
        month: { used: used.monthUsed, limit: deps.limits.perMonth, resetsAt: nextUtcMonth(now()).toISOString() },
        hour: { used: used.hourUsed, limit: deps.limits.perHour, resetsAt: used.hourRetryAt?.toISOString() ?? null },
        running: { now: deps.policy.snapshot().runningOf(id), limit: deps.limits.runningPerUser },
        lastAt,
      };
      return c.json(detail);
    }),
  );

  return app;
}
