import type { Place } from "../../../shared/onboarding.js";

const PHOTON = "https://photon.komoot.io/api/";
const LIMIT = 5;
const TIMEOUT_MS = 4000;

type PhotonProps = {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  type?: string;
};
type PhotonFeature = { properties?: PhotonProps; geometry?: { coordinates?: [number, number] } };

const CITY_TYPES = new Set(["city", "town", "village", "locality"]);

function toPlace(f: PhotonFeature): Place | null {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  const city = p.city ?? (p.type && CITY_TYPES.has(p.type) ? p.name : undefined) ?? p.district ?? p.county;
  const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(" ") : undefined;
  const first = street ?? p.name;
  const parts = [...new Set([first, city, p.state, p.country].filter((x): x is string => !!x))];
  if (!parts.length) return null;
  const country = p.countrycode?.toUpperCase();
  return {
    label: parts.join(", "),
    ...(city && { city }),
    ...(p.state && { region: p.state }),
    ...(country && /^[A-Z]{2}$/.test(country) && { country }),
    lat,
    lon,
  };
}

export async function searchPlaces(q: string, f: typeof fetch = fetch): Promise<Place[]> {
  const query = q.trim().slice(0, 200);
  if (query.length < 3) return [];
  const url = new URL(PHOTON);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(LIMIT));
  url.searchParams.set("lang", "en");
  try {
    const res = await f(url, { headers: { "user-agent": "OpenAgent/1.0" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const features = ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    const seen = new Set<string>();
    return features
      .map(toPlace)
      .filter((p): p is Place => !!p && !seen.has(p.label) && !!seen.add(p.label))
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}
