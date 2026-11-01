import { type Context, Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import { UserError } from "../lib/errors.js";
import { limitBy, type RateLimiter } from "../lib/rateLimit.js";
import type { UserHubs } from "../providers/hubs.js";
import type { LoginFlows } from "../providers/logins.js";
import { defaultModelRef } from "../session/createSession.js";
import { body, safe } from "./handlers.js";
import type { ProfilesFor } from "./profile.js";

type Deps = { hubs: UserHubs; logins: LoginFlows; profiles: ProfilesFor; limiter: RateLimiter };
type C = Context<AuthEnv>;

const param = (c: C, name: string) => c.req.param(name) ?? "";
const EXPIRED = "This sign-in expired. Start it again.";

export function providerRoutes(deps: Deps) {
  const app = new Hono<AuthEnv>();
  const hub = (c: C) => deps.hubs.get(c.get("user"));
  const mutate = async (c: C, fn: (h: Awaited<ReturnType<typeof hub>>) => Promise<unknown>) => {
    await fn(await hub(c));
    deps.hubs.invalidate(c.get("user").id);
  };
  const keys = limitBy<AuthEnv>(deps.limiter, "keys");

  app.get(
    "/models",
    safe<AuthEnv>(async (c) => {
      const [h, profile] = await Promise.all([hub(c), deps.profiles(c.get("user").id).get()]);
      return c.json({ default: defaultModelRef(h, profile.defaultModel), models: h.enabledModels() });
    }),
  );
  app.get(
    "/providers",
    safe<AuthEnv>(async (c) => c.json({ providers: (await hub(c)).list() })),
  );
  app.post(
    "/providers/local",
    keys,
    safe<AuthEnv>(async (c) => {
      const b = await body(c);
      const h = await hub(c);
      const provider = await h.addLocal({
        kind: String(b.kind ?? ""),
        baseUrl: String(b.baseUrl ?? ""),
        ...(typeof b.apiKey === "string" && { apiKey: b.apiKey }),
        ...(typeof b.label === "string" && { label: b.label }),
      });
      deps.hubs.invalidate(c.get("user").id);
      return c.json({ provider });
    }),
  );
  app.post(
    "/providers/test",
    keys,
    safe<AuthEnv>(async (c) => c.json(await (await hub(c)).test(String((await body(c)).model ?? "")))),
  );
  app.get(
    "/providers/logins/:flow",
    safe<AuthEnv>((c) => {
      const state = deps.logins.get(c.get("user").id, param(c, "flow"));
      if (!state) throw new UserError(EXPIRED, "not_found");
      return c.json(state);
    }),
  );
  app.post(
    "/providers/logins/:flow/answer",
    safe<AuthEnv>(async (c) => {
      const b = await body(c);
      deps.logins.answer(c.get("user").id, param(c, "flow"), typeof b.value === "string" ? b.value : "");
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/providers/logins/:flow",
    safe<AuthEnv>((c) => {
      deps.logins.cancel(c.get("user").id, param(c, "flow"));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/providers/:id/login",
    limitBy<AuthEnv>(deps.limiter, "login"),
    safe<AuthEnv>(async (c) => {
      const id = param(c, "id");
      const provider = (await hub(c)).list().find((p) => p.id === id);
      if (!provider) throw new UserError(`provider ${id} is not supported`, "not_found");
      if (!provider.methods.includes("oauth")) throw new UserError(`${provider.label} has no sign-in option here`);
      return c.json({ flow: deps.logins.start(c.get("user"), id) });
    }),
  );
  app.post(
    "/providers/:id/key",
    keys,
    safe<AuthEnv>(async (c) => {
      const b = await body(c);
      await mutate(c, (h) => h.setKey(param(c, "id"), typeof b.apiKey === "string" ? b.apiKey : ""));
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/providers/:id",
    keys,
    safe<AuthEnv>(async (c) => {
      await mutate(c, (h) => h.remove(param(c, "id")));
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/providers/:id/models",
    safe<AuthEnv>(async (c) => c.json({ models: (await hub(c)).models(param(c, "id")) })),
  );
  app.put(
    "/providers/:id/models",
    safe<AuthEnv>(async (c) => {
      const b = await body(c);
      await mutate(c, (h) => h.setEnabled(param(c, "id"), Array.isArray(b.enabled) ? b.enabled.map(String) : []));
      return c.json({ ok: true });
    }),
  );

  return app;
}
