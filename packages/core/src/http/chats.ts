import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import { normalizeId } from "@oab/shared/ids";
import { CHATS_PAGE_SIZE } from "@oab/shared/lists";
import type { UserRepos } from "../store/types.js";
import { UserError } from "../lib/errors.js";
import type { RateLimiter } from "../lib/rateLimit.js";
import { limitBy, pageParam, safe } from "./handlers.js";

const missing = () => new UserError("This chat doesn't exist.", "not_found");

export function chatRoutes(deps: { repos: (userId: string) => Pick<UserRepos, "chats" | "messages">; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  app.use("/chats", limitBy<AuthEnv>(deps.limiter, "chats"));
  app.use("/chats/*", limitBy<AuthEnv>(deps.limiter, "chats"));

  app.get(
    "/chats",
    safe<AuthEnv>(async (c) => {
      const page = pageParam(c);
      const { items, total } = await deps.repos(c.get("user").id).chats.page(page);
      return c.json({ items, total, page, pageSize: CHATS_PAGE_SIZE });
    }),
  );
  app.get(
    "/chats/:id",
    safe<AuthEnv>(async (c) => {
      const id = normalizeId(c.req.param("id"));
      const chat = id && (await deps.repos(c.get("user").id).chats.get(id));
      if (!chat) throw missing();
      return c.json({ chat });
    }),
  );
  app.get(
    "/chats/:id/messages",
    safe<AuthEnv>(async (c) => {
      const id = normalizeId(c.req.param("id"));
      if (!id) throw missing();
      const repos = deps.repos(c.get("user").id);
      if (!(await repos.chats.exists(id))) throw missing();
      return c.json(await repos.messages.history(id));
    }),
  );
  return app;
}
