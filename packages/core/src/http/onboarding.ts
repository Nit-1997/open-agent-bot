import { Hono } from "hono";
import type { Place } from "@oab/shared/onboarding";
import type { AuthEnv } from "../auth/middleware.js";
import type { RateLimiter } from "../lib/rateLimit.js";
import { type OptionsDeps, onboardingOptions } from "../onboarding/options.js";
import { searchPlaces } from "../onboarding/places.js";
import { limitBy, safe } from "./handlers.js";

export type OnboardingDeps = Partial<OptionsDeps> & { places?: (q: string) => Promise<Place[]> };

const num = (v: string | undefined, min: number, max: number) => {
  const n = v == null || v === "" ? Number.NaN : Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

export function onboardingRoutes(deps: OnboardingDeps & { limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  const places = deps.places ?? ((q: string) => searchPlaces(q));

  app.get(
    "/places",
    limitBy<AuthEnv>(deps.limiter, "places"),
    safe<AuthEnv>(async (c) => c.json({ places: await places((c.req.query("q") ?? "").slice(0, 200)) })),
  );
  app.get(
    "/onboarding/options",
    limitBy<AuthEnv>(deps.limiter, "options"),
    safe<AuthEnv>(async (c) => {
      if (!deps.registry) return c.json({ error: "unavailable", message: "options are not available" }, 503);
      const lat = num(c.req.query("lat"), -90, 90);
      const lon = num(c.req.query("lon"), -180, 180);
      const country = /^[A-Za-z]{2}$/.test(c.req.query("country") ?? "") ? c.req.query("country") : undefined;
      return c.json(await onboardingOptions({ lat, lon, country }, { registry: deps.registry, groceries: deps.groceries }));
    }),
  );
  return app;
}
