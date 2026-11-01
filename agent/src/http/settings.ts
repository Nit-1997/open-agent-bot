import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import { limitBy, type RateLimiter } from "../lib/rateLimit.js";
import type { UserHubs } from "../providers/hubs.js";
import { body, safe } from "./handlers.js";

export function settingsRoutes(deps: { hubs: UserHubs; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();

  app.get(
    "/settings",
    safe<AuthEnv>(async (c) => {
      const hub = await deps.hubs.get(c.get("user"));
      const hint = hub.secretHint("brave-search");
      return c.json({ braveSearch: !!hub.secret("brave-search"), ...(hint && { braveSearchHint: hint }) });
    }),
  );
  app.post(
    "/settings/brave-search/key",
    limitBy<AuthEnv>(deps.limiter, "keys"),
    safe<AuthEnv>(async (c) => {
      const b = await body(c);
      const user = c.get("user");
      await (await deps.hubs.get(user)).setSecret("brave-search", typeof b.apiKey === "string" ? b.apiKey : "");
      deps.hubs.invalidate(user.id);
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/settings/brave-search",
    limitBy<AuthEnv>(deps.limiter, "keys"),
    safe<AuthEnv>(async (c) => {
      const user = c.get("user");
      await (await deps.hubs.get(user)).removeSecret("brave-search");
      deps.hubs.invalidate(user.id);
      return c.json({ ok: true });
    }),
  );
  return app;
}
