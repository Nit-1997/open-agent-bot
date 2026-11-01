import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import { log } from "../lib/log.js";
import { limitBy, type RateLimiter } from "../lib/rateLimit.js";
import type { ProfileStore } from "../profile/store.js";
import { body, safe } from "./handlers.js";

export type ProfilesFor = (userId: string) => ProfileStore;

export function profileRoutes(deps: { profiles: ProfilesFor; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  app.get(
    "/profile",
    safe<AuthEnv>(async (c) => c.json({ profile: await deps.profiles(c.get("user").id).get() })),
  );
  app.put(
    "/profile",
    limitBy<AuthEnv>(deps.limiter, "profile"),
    safe<AuthEnv>(async (c) => {
      const profile = await deps.profiles(c.get("user").id).put((await body(c)).profile);
      log.debug(`[profile] user=${c.get("user").id} saved ${JSON.stringify(profile)}`);
      return c.json({ profile });
    }),
  );
  return app;
}
