import { INDEPENDENT } from "../../../shared/onboarding.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { RetailSource } from "../sources/retail/types.js";
import type { StayKind, StaySource } from "../stays/types.js";
import type { ProfileOverride } from "../prompt/userContext.js";

const MAX_STORES = 3;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function knownStore(registry: SourceRegistry, name: string): RetailSource | undefined {
  const n = norm(name);
  return registry
    .select<RetailSource>({ vertical: "retail" })
    .find((s) => norm(s.id) === n || norm(s.label) === n || s.aliases?.some((a) => norm(a) === n) || s.domains.some((d) => norm(d) === n));
}

const ids = (registry: SourceRegistry, names: string[] | undefined, region: string) =>
  (names ?? [])
    .map((n) => knownStore(registry, n))
    .filter((s): s is RetailSource => !!s && (s.regions.includes("*") || s.regions.includes(region)))
    .map((s) => s.id);

const firstUnique = (list: string[]) => [...new Set(list)].slice(0, MAX_STORES);

export type ShopDefaults = { grocery: string[]; general: string[] };

export function shopDefaults(
  profile: ProfileOverride | undefined,
  region: string,
  registry: SourceRegistry,
  regional: (kind: "grocery" | "general") => string[],
): ShopDefaults {
  return {
    grocery: firstUnique([...ids(registry, profile?.shopping?.groceries, region), ...regional("grocery")]),
    general: firstUnique([...ids(registry, profile?.shopping?.retail, region), ...regional("general")]),
  };
}

export type StaysDefaults = { type: StayKind | "any"; sources: string[]; brands: string[] };

export function staysDefaults(profile: ProfileOverride | undefined, sources: StaySource[]): StaysDefaults {
  const stays = profile?.travel?.stays ?? [];
  const sites = (profile?.travel?.sites ?? []).map(norm);
  return {
    type: stays.length === 1 ? stays[0] : "any",
    sources: sources.filter((s) => s.read && sites.includes(norm(s.label))).map((s) => s.id),
    brands: (profile?.travel?.hotelChains ?? []).filter((c) => c !== INDEPENDENT),
  };
}
