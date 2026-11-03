import type { LatLon } from "../tools/geo.js";

export const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const RADIUS_M = 10_000;
const TOP = 6;

type Element = { tags?: Record<string, string> };

const cache = new Map<string, string[]>();

export function rankBrands(elements: Element[], top = TOP): string[] {
  const counts = new Map<string, number>();
  for (const e of elements) {
    const name = (e.tags?.brand ?? e.tags?.name ?? "").trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, top)
    .map(([name]) => name);
}

export async function nearbyGroceries(
  at: LatLon,
  opts: { fetch?: typeof fetch; timeoutMs?: number; endpoints?: string[] } = {},
): Promise<string[] | null> {
  const key = `${at.lat.toFixed(2)},${at.lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const f = opts.fetch ?? fetch;
  const query = `[out:json][timeout:3];nwr["shop"="supermarket"](around:${RADIUS_M},${at.lat},${at.lon});out tags 300;`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 3000);
  try {
    const brands = await Promise.any(
      (opts.endpoints ?? OVERPASS).map(async (endpoint) => {
        const url = new URL(endpoint);
        url.searchParams.set("data", query);
        const res = await f(url, { headers: { "user-agent": "OpenAgent/1.0" }, signal: ac.signal });
        if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
        const ranked = rankBrands(((await res.json()) as { elements?: Element[] }).elements ?? []);
        if (!ranked.length) throw new Error("no supermarkets");
        return ranked;
      }),
    );
    cache.set(key, brands);
    return brands;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}
