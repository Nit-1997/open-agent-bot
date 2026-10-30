import { Hono } from "hono";
import type { ProfileStore } from "../profile/store.js";
import { log } from "../lib/log.js";
import { type Authorized, body, requireSecret, safe } from "./handlers.js";

export function profileRoutes(deps: { profiles?: ProfileStore; authorized: Authorized }) {
  const app = new Hono();
  app.use("/profile", requireSecret(deps.authorized));
  app.use("/profile", async (c, next) => (deps.profiles ? next() : c.json({ error: "profiles are not available" }, 503)));

  app.get(
    "/profile",
    safe(async (c) => c.json({ profile: await deps.profiles!.get() })),
  );
  app.put(
    "/profile",
    safe(async (c) => {
      const b = await body(c);
      const profile = await deps.profiles!.put(b.profile);
      log.debug(`[profile] saved ${JSON.stringify(profile)}`);
      return c.json({ profile });
    }),
  );
  return app;
}
