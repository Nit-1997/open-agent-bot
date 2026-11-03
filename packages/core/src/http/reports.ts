import { Hono } from "hono";
import { REPORTS_PAGE_SIZE, type ReportSummary } from "@oab/shared/lists";
import type { AuthEnv } from "../auth/middleware.js";
import type { ArtifactListRow, UserRepos } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import type { RateLimiter } from "../lib/rateLimit.js";
import { limitBy, pageParam, safe } from "./handlers.js";

const missing = () => new UserError("That report doesn't exist.", "not_found");

export const toReportSummary = (r: ArtifactListRow, titles: Map<string, string>): ReportSummary => {
  const chatTitle = r.chatId ? titles.get(r.chatId) : undefined;
  return {
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    chatId: chatTitle === undefined ? null : r.chatId,
    chatTitle: chatTitle ?? null,
    pdfReady: r.pdfReady,
    sizeBytes: r.sizeBytes,
  };
};

type Repos = (userId: string) => Pick<UserRepos, "artifacts" | "chats">;

export function reportRoutes(deps: { repos: Repos; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  app.use("/reports", limitBy<AuthEnv>(deps.limiter, "lists"));
  app.use("/reports/*", limitBy<AuthEnv>(deps.limiter, "lists"));

  app.get(
    "/reports",
    safe<AuthEnv>(async (c) => {
      const page = pageParam(c);
      const repos = deps.repos(c.get("user").id);
      const { items, total } = await repos.artifacts.page(page);
      const titles = await repos.chats.titles(items.flatMap((r) => (r.chatId ? [r.chatId] : [])));
      return c.json({ items: items.map((r) => toReportSummary(r, titles)), total, page, pageSize: REPORTS_PAGE_SIZE });
    }),
  );
  app.get(
    "/reports/:id",
    safe<AuthEnv>(async (c) => {
      const repos = deps.repos(c.get("user").id);
      const row = await repos.artifacts.summary(c.req.param("id") ?? "");
      if (!row) throw missing();
      const titles = await repos.chats.titles(row.chatId ? [row.chatId] : []);
      return c.json({ report: toReportSummary(row, titles) });
    }),
  );
  return app;
}
