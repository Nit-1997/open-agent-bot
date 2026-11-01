import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import { PAGE_SIZE, type UserRepos } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import { limitBy, type RateLimiter } from "../lib/rateLimit.js";
import { pageParam, safe } from "./handlers.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      return c.json({ items, total, page, pageSize: PAGE_SIZE });
    }),
  );
  app.get(
    "/chats/:id/messages",
    safe<AuthEnv>(async (c) => {
      const id = (c.req.param("id") ?? "").toLowerCase();
      if (!UUID_RE.test(id)) throw missing();
      const repos = deps.repos(c.get("user").id);
      if (!(await repos.chats.exists(id))) throw missing();
      return c.json(await repos.messages.history(id));
    }),
  );
  return app;
}
