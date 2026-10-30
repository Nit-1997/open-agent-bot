import { Hono } from "hono";
import type { ProviderHub } from "../providers/hub.js";
import { type Authorized, body, requireSecret, safe } from "./handlers.js";

export function settingsRoutes(deps: { hub?: ProviderHub; authorized: Authorized }) {
  const app = new Hono();
  for (const path of ["/settings", "/settings/*"]) {
    app.use(path, requireSecret(deps.authorized));
    app.use(path, async (c, next) => (deps.hub ? next() : c.json({ error: "settings are not available" }, 503)));
  }
  const hub = () => deps.hub!;

  app.get(
    "/settings",
    safe((c) => c.json({ braveSearch: !!hub().secret("brave-search") })),
  );
  app.post(
    "/settings/brave-search/key",
    safe(async (c) => {
      const b = await body(c);
      await hub().setSecret("brave-search", typeof b.apiKey === "string" ? b.apiKey : "");
      return c.json({ ok: true });
    }),
  );
  app.delete(
    "/settings/brave-search",
    safe(async (c) => {
      await hub().removeSecret("brave-search");
      return c.json({ ok: true });
    }),
  );
  return app;
}
