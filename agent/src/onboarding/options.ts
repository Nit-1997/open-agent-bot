import { type Chip, curatedFor, type OnboardingOptions } from "@oab/shared/onboarding";
import { currencyOf, unitsOf } from "../prompt/region.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { FlightSource } from "../sources/flights/google.js";
import type { StaySource } from "../stays/types.js";
import { type LatLon, nearbyAirports } from "../tools/geo.js";

const GROCERY_CHIPS = 6;
const AIRPORTS = 3;

export type OptionsQuery = { lat?: number; lon?: number; country?: string };
export type OptionsDeps = { registry: SourceRegistry; groceries?: (at: LatLon) => Promise<string[] | null> };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function travelSites(registry: SourceRegistry, country: string, extras: string[]): Chip[] {
  const flights = registry.select<FlightSource>({ vertical: "flights", region: country });
  const stays = registry.select<StaySource>({ vertical: "stays", region: country });
  const known: Chip[] = [
    ...flights.map((s): Chip => ({ label: s.label, access: "searched" })),
    ...stays.map((s): Chip => ({ label: s.label, access: s.read ? "searched" : "linked" })),
  ].sort((a, b) => Number(b.access === "searched") - Number(a.access === "searched"));
  const seen = new Set(known.map((c) => norm(c.label)));
  return [...known, ...extras.filter((e) => !seen.has(norm(e))).map((label): Chip => ({ label, access: "linked" }))];
}

const dedupe = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(norm(x)) && !!seen.add(norm(x)));
};

export async function onboardingOptions(q: OptionsQuery, deps: OptionsDeps): Promise<OnboardingOptions> {
  const country = q.country?.toUpperCase() || "US";
  const curated = curatedFor(country);
  const at = q.lat != null && q.lon != null ? { lat: q.lat, lon: q.lon } : undefined;
  const nearby = at && deps.groceries ? await deps.groceries(at).catch(() => null) : null;
  return {
    country,
    currency: currencyOf(country) ?? "USD",
    units: unitsOf(country),
    airports: at ? nearbyAirports(at).slice(0, AIRPORTS) : [],
    groceriesNearby: !!nearby?.length,
    rows: {
      airlines: curated.airlines,
      hotelChains: curated.hotelChains,
      sites: travelSites(deps.registry, country, curated.sites),
      groceries: dedupe([...(nearby ?? []), ...curated.groceries]).slice(0, GROCERY_CHIPS),
      retail: curated.retail,
      delivery: curated.delivery,
    },
  };
}
