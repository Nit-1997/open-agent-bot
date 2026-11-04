import { body, safe } from "@oab/core/http/handlers.js";
import type { AuthEnv } from "@oab/core/identity/types.js";
import { type RateLimiter, rateLimitError } from "@oab/core/lib/rateLimit.js";
import { Hono } from "hono";
import { SELF_DELETE } from "../limits/config.js";
import type { SelfDelete } from "./selfDelete.js";

export type AccountRouteDeps = { selfDelete: SelfDelete; limiter: RateLimiter };

export function accountRoutes(deps: AccountRouteDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.post(
    "/account/delete",
    safe<AuthEnv>(async (c) => {
      const user = c.get("user");
      const verdict = deps.limiter.take(`account-delete:${user.id}`, SELF_DELETE);
      if (!verdict.ok) throw rateLimitError(verdict.retryAfter);
      await deps.selfDelete(user, (await body(c)).confirmEmail);
      return c.json({ ok: true });
    }),
  );
  return app;
}
