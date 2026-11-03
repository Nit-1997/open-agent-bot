import { Hono } from "hono";
import {
  isSearchScope,
  normalizeQuery,
  SEARCH_MAX,
  SEARCH_MIN,
  SEARCH_PAGE_SIZE,
  type SearchHit,
  type SearchResponse,
  type SearchScope,
  SNIPPET_CHARS,
  searchOffsetOk,
} from "@oab/shared/lists";
import type { AuthEnv } from "../auth/middleware.js";
import type { SearchRow, UserRepos } from "../store/types.js";
import { UserError } from "../lib/errors.js";
import { ConcurrencyGate, type RateLimiter, rateLimitError, SEARCH_CONCURRENCY } from "../lib/rateLimit.js";
import { errorResponse, limitBy, pageParam, safe } from "./handlers.js";

const collapse = (s: string) => s.replace(/\s+/gu, " ");

export function toHit(r: SearchRow, titles: Map<string, string>): SearchHit {
  if (r.kind === "report") {
    const chatTitle = r.chatId ? titles.get(r.chatId) : undefined;
    return {
      kind: "report",
      id: r.refId,
      title: r.title,
      at: r.at,
      chatId: chatTitle === undefined ? null : r.chatId,
      chatTitle: chatTitle ?? null,
    };
  }
  const snippet =
    r.snippet !== null && r.snippetStart !== null && r.contentLength !== null
      ? {
          text: collapse(r.snippet),
          truncatedStart: r.snippetStart > 1,
          truncatedEnd: r.snippetStart + SNIPPET_CHARS <= r.contentLength,
        }
      : null;
  return { kind: "chat", chatId: r.refId, title: r.title, at: r.at, match: r.match, snippet };
}

type Repos = (userId: string) => Pick<UserRepos, "search" | "chats">;

export function searchRoutes(deps: { repos: Repos; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  const gate = new ConcurrencyGate(SEARCH_CONCURRENCY);
  app.use("/search", limitBy<AuthEnv>(deps.limiter, "search"));
  app.use("/search", async (c, next) => {
    const leave = gate.enter(c.get("user").id);
    if (!leave) return errorResponse(c, rateLimitError(1));
    try {
      await next();
    } finally {
      leave();
    }
  });

  app.get(
    "/search",
    safe<AuthEnv>(async (c) => {
      const query = normalizeQuery(c.req.query("q") ?? "");
      if (!query) throw new UserError(`Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.`, "invalid");
      const rawScope = c.req.query("scope") || "all";
      if (!isSearchScope(rawScope)) throw new UserError("scope must be all, chats or reports", "invalid");
      const scope: SearchScope = rawScope;
      const page = pageParam(c);
      if (!searchOffsetOk(page)) throw new UserError("That page is too far back.", "invalid");
      const repos = deps.repos(c.get("user").id);
      const result = await repos.search.search(query, scope, page);
      const reportChats = result.items.flatMap((r) => (r.kind === "report" && r.chatId ? [r.chatId] : []));
      const titles = await repos.chats.titles(reportChats);
      const body: SearchResponse = {
        items: result.items.map((r) => toHit(r, titles)),
        total: result.total,
        page,
        pageSize: SEARCH_PAGE_SIZE,
        query,
        scope,
        counts: { chats: result.chats, reports: result.reports },
      };
      return c.json(body);
    }),
  );
  return app;
}
