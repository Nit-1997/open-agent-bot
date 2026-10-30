import { type Context, type Handler, Hono, type MiddlewareHandler } from "hono";
import type { AgentConfig } from "../config.js";
import type { ProviderHub } from "../providers/hub.js";
import type { LoginFlows } from "../providers/logins.js";
import { defaultModelRef } from "./defaultModel.js";

type Deps = { cfg: AgentConfig; hub?: ProviderHub; logins?: LoginFlows; authorized: (secret: string | undefined) => boolean };

const safe =
  (handler: (c: Context) => Promise<Response> | Response): Handler =>
  async (c) => {
    try {
      return await handler(c);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  };

const param = (c: Context, name: string) => c.req.param(name) ?? "";

const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

export function providerRoutes(deps: Deps) {
  const app = new Hono();

  const guard: MiddlewareHandler = async (c, next) => {
    if (!deps.authorized(c.req.header("x-agent-secret"))) return c.json({ error: "unauthorized" }, 401);
    if (!deps.hub) return c.json({ error: "providers are not available" }, 503);
    await next();
  };
  for (const path of ["/models", "/providers", "/providers/*"]) app.use(path, guard);

  const hub = () => deps.hub!;
  const logins = () => {
    if (!deps.logins) throw new Error("sign-in is not available");
    return deps.logins;
  };

  app.get(
    "/models",
    safe((c) => c.json({ default: defaultModelRef(deps.cfg, hub()), models: hub().enabledModels() })),
  );
  app.get(
    "/providers",
    safe((c) => c.json({ providers: hub().list() })),
  );
  app.post(
    "/providers/local",
    safe(async (c) => {
      const b = await body(c);
      const provider = await hub().addLocal({
        kind: String(b.kind ?? ""),
        baseUrl: String(b.baseUrl ?? ""),
        ...(typeof b.apiKey === "string" && { apiKey: b.apiKey }),
        ...(typeof b.label === "string" && { label: b.label }),
      });
      return c.json({ provider });
    }),
  );
  app.post(
    "/providers/test",
    safe(async (c) => c.json(await hub().test(String((await body(c)).model ?? "")))),
  );
  app.get(
    "/providers/logins/:flow",
    safe((c) => {
      const state = logins().get(param(c, "flow"));
      return state ? c.json(state) : c.json({ error: "This sign-in expired. Start it again." }, 404);
    }),
  );
  app.post(
    "/providers/logins/:flow/answer",
    safe(async (c) => {
      const b = await body(c);
      logins().answer(param(c, "flow"), typeof b.value === "string" ? b.value : "");
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/providers/logins/:flow",
    safe((c) => {
      logins().cancel(param(c, "flow"));
      return c.json({ ok: true });
    }),
  );
  app.post(
    "/providers/:id/login",
    safe((c) => {
      const id = param(c, "id");
      const provider = hub()
        .list()
        .find((p) => p.id === id);
      if (!provider) throw new Error(`provider ${id} is not supported`);
      if (!provider.methods.includes("oauth")) throw new Error(`${provider.label} has no sign-in option here`);
      return c.json({ flow: logins().start(id) });
    }),
  );
  app.post(
    "/providers/:id/key",
    safe(async (c) => {
      const b = await body(c);
      await hub().setKey(param(c, "id"), typeof b.apiKey === "string" ? b.apiKey : "");
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/providers/:id",
    safe(async (c) => {
      await hub().remove(param(c, "id"));
      return c.json({ ok: true });
    }),
  );
  app.get(
    "/providers/:id/models",
    safe((c) => c.json({ models: hub().models(param(c, "id")) })),
  );
  app.put(
    "/providers/:id/models",
    safe(async (c) => {
      const b = await body(c);
      await hub().setEnabled(param(c, "id"), Array.isArray(b.enabled) ? b.enabled.map(String) : []);
      return c.json({ ok: true });
    }),
  );

  return app;
}
