import { Hono } from "hono";
import { type AgentPersona, agentPersona } from "../../../shared/profile.js";
import type { AuthEnv } from "../auth/middleware.js";
import { log } from "../lib/log.js";
import type { RateLimiter } from "../lib/rateLimit.js";
import type { ProfileStore } from "../profile/store.js";
import type { SessionStore } from "../session/sessionStore.js";
import { body, limitBy, safe } from "./handlers.js";

export type ProfilesFor = (userId: string) => ProfileStore;

const samePersona = (a: AgentPersona, b: AgentPersona) => a.name === b.name && a.look === b.look && a.tone === b.tone;

export function profileRoutes(deps: { profiles: ProfilesFor; limiter: RateLimiter; sessions: Pick<SessionStore, "retireUser"> }) {
  const app = new Hono<AuthEnv>();
  app.get(
    "/profile",
    safe<AuthEnv>(async (c) => c.json({ profile: await deps.profiles(c.get("user").id).get() })),
  );
  app.put(
    "/profile",
    limitBy<AuthEnv>(deps.limiter, "profile"),
    safe<AuthEnv>(async (c) => {
      const userId = c.get("user").id;
      const store = deps.profiles(userId);
      const before = agentPersona(await store.get());
      const profile = await store.put((await body(c)).profile);
      if (!samePersona(before, agentPersona(profile))) await deps.sessions.retireUser(userId);
      log.debug(`[profile] user=${userId} saved ${JSON.stringify(profile)}`);
      return c.json({ profile });
    }),
  );
  return app;
}
