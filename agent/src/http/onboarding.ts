import { Hono } from "hono";
import type { Place } from "../../../shared/onboarding.js";
import { type OptionsDeps, onboardingOptions } from "../onboarding/options.js";
import { searchPlaces } from "../onboarding/places.js";
import { type Authorized, requireSecret, safe } from "./handlers.js";

export type OnboardingDeps = Partial<OptionsDeps> & { places?: (q: string) => Promise<Place[]> };

const num = (v: string | undefined, min: number, max: number) => {
  const n = v == null || v === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function onboardingRoutes(deps: OnboardingDeps & { authorized: Authorized }) {
  const app = new Hono();
  for (const path of ["/places", "/onboarding/*"]) app.use(path, requireSecret(deps.authorized));
  const places = deps.places ?? ((q: string) => searchPlaces(q));

  app.get(
    "/places",
    safe(async (c) => c.json({ places: await places(c.req.query("q") ?? "") })),
  );
  app.get(
    "/onboarding/options",
    safe(async (c) => {
      if (!deps.registry) return c.json({ error: "options are not available" }, 503);
      const lat = num(c.req.query("lat"), -90, 90);
      const lon = num(c.req.query("lon"), -180, 180);
      const country = /^[A-Za-z]{2}$/.test(c.req.query("country") ?? "") ? c.req.query("country") : undefined;
      return c.json(await onboardingOptions({ lat, lon, country }, { registry: deps.registry, groceries: deps.groceries }));
    }),
  );
  return app;
}
