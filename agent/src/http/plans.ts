import { Hono } from "hono";
import { normalizeId } from "../../../shared/ids.js";
import { PLANS_PAGE_SIZE, type PlanCounts } from "../../../shared/lists.js";
import { ENTITY_KINDS, entityIdFromKey, isEntityKind } from "../../../shared/workspace.js";
import type { AuthEnv } from "../auth/middleware.js";
import type { EntityCounts, UserRepos } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import type { RateLimiter } from "../lib/rateLimit.js";
import { planSummary, planWidget } from "../plans/view.js";
import { limitBy, pageParam, safe } from "./handlers.js";

const missing = () => new UserError("This plan doesn't exist.", "not_found");

const withAll = (c: EntityCounts): PlanCounts => ({ ...c, all: ENTITY_KINDS.reduce((n, k) => n + c[k], 0) });

type Repos = (userId: string) => Pick<UserRepos, "workspace" | "chats">;

export function planRoutes(deps: { repos: Repos; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  app.use("/plans", limitBy<AuthEnv>(deps.limiter, "lists"));
  app.use("/plans/*", limitBy<AuthEnv>(deps.limiter, "lists"));

  app.get(
    "/plans",
    safe<AuthEnv>(async (c) => {
      const page = pageParam(c);
      const kind = c.req.query("kind");
      if (kind !== undefined && kind !== "" && !isEntityKind(kind))
        throw new UserError("kind must be cart, trip, event or shortlist", "invalid");
      const repos = deps.repos(c.get("user").id);
      const [{ items, total }, counts] = await Promise.all([repos.workspace.page(page, kind || undefined), repos.workspace.counts()]);
      const titles = await repos.chats.titles(items.map((e) => e.chatId));
      return c.json({
        items: items.map((e) => planSummary(e, titles.get(e.chatId))),
        total,
        page,
        pageSize: PLANS_PAGE_SIZE,
        counts: withAll(counts),
      });
    }),
  );
  app.get(
    "/plans/:chatId/:kind/:key",
    safe<AuthEnv>(async (c) => {
      const chatId = normalizeId(c.req.param("chatId"));
      const kind = c.req.param("kind");
      const id = entityIdFromKey(c.req.param("key"));
      if (!chatId || !isEntityKind(kind) || id === undefined) throw missing();
      const repos = deps.repos(c.get("user").id);
      const [entity, chat] = await Promise.all([repos.workspace.get(chatId, kind, id), repos.chats.get(chatId)]);
      if (!entity || !chat) throw missing();
      const stored = { ...entity, chatId };
      const widget = planWidget(stored);
      if (!widget) throw new UserError("This plan was saved in a shape the app can't show.", "unprocessable", { code: "invalid_plan" });
      return c.json({ plan: planSummary(stored, chat.title), widget });
    }),
  );
  return app;
}
