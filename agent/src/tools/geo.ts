import { timeoutSignal } from "./net.js";

export type LatLon = { lat: number; lon: number };
export type Airport = LatLon & { name: string };

export const AIRPORTS: Record<string, Airport> = {
  SFO: { name: "San Francisco", lat: 37.6213, lon: -122.379 },
  OAK: { name: "Oakland", lat: 37.7126, lon: -122.2197 },
  SJC: { name: "San Jose", lat: 37.3639, lon: -121.9289 },
  SMF: { name: "Sacramento", lat: 38.6954, lon: -121.5908 },
  LAX: { name: "Los Angeles", lat: 33.9416, lon: -118.4085 },
  BUR: { name: "Burbank", lat: 34.2007, lon: -118.3585 },
  LGB: { name: "Long Beach", lat: 33.8177, lon: -118.1516 },
  SNA: { name: "Orange County", lat: 33.6757, lon: -117.8682 },
  ONT: { name: "Ontario", lat: 34.056, lon: -117.6012 },
  SAN: { name: "San Diego", lat: 32.7338, lon: -117.1933 },
  JFK: { name: "New York JFK", lat: 40.6413, lon: -73.7781 },
  LGA: { name: "New York LaGuardia", lat: 40.7769, lon: -73.874 },
  EWR: { name: "Newark", lat: 40.6895, lon: -74.1745 },
  HPN: { name: "Westchester", lat: 41.067, lon: -73.7076 },
  DCA: { name: "Washington National", lat: 38.8512, lon: -77.0402 },
  IAD: { name: "Washington Dulles", lat: 38.9531, lon: -77.4565 },
  BWI: { name: "Baltimore", lat: 39.1754, lon: -76.6683 },
  ORD: { name: "Chicago O'Hare", lat: 41.9742, lon: -87.9073 },
  MDW: { name: "Chicago Midway", lat: 41.7868, lon: -87.7522 },
  DFW: { name: "Dallas/Fort Worth", lat: 32.8998, lon: -97.0403 },
  DAL: { name: "Dallas Love Field", lat: 32.8471, lon: -96.8518 },
  IAH: { name: "Houston Bush", lat: 29.9902, lon: -95.3368 },
  HOU: { name: "Houston Hobby", lat: 29.6454, lon: -95.2789 },
  MIA: { name: "Miami", lat: 25.7959, lon: -80.287 },
  FLL: { name: "Fort Lauderdale", lat: 26.0742, lon: -80.1506 },
  PBI: { name: "West Palm Beach", lat: 26.6832, lon: -80.0956 },
  BOS: { name: "Boston", lat: 42.3656, lon: -71.0096 },
  PVD: { name: "Providence", lat: 41.7267, lon: -71.4204 },
  MHT: { name: "Manchester", lat: 42.9326, lon: -71.4357 },
  SEA: { name: "Seattle", lat: 47.4502, lon: -122.3088 },
  PAE: { name: "Everett", lat: 47.9063, lon: -122.2816 },
  PDX: { name: "Portland", lat: 45.5898, lon: -122.5951 },
  PHL: { name: "Philadelphia", lat: 39.8744, lon: -75.2424 },
  ATL: { name: "Atlanta", lat: 33.6407, lon: -84.4277 },
  DEN: { name: "Denver", lat: 39.8561, lon: -104.6737 },
  LAS: { name: "Las Vegas", lat: 36.084, lon: -115.1537 },
  PHX: { name: "Phoenix", lat: 33.4352, lon: -112.0101 },
  AUS: { name: "Austin", lat: 30.1975, lon: -97.6664 },
  SAT: { name: "San Antonio", lat: 29.5337, lon: -98.4698 },
  MCO: { name: "Orlando", lat: 28.4312, lon: -81.3081 },
  TPA: { name: "Tampa", lat: 27.9755, lon: -82.5332 },
  MSP: { name: "Minneapolis", lat: 44.8848, lon: -93.2223 },
  DTW: { name: "Detroit", lat: 42.2162, lon: -83.3554 },
  CLT: { name: "Charlotte", lat: 35.2144, lon: -80.9473 },
  BNA: { name: "Nashville", lat: 36.1263, lon: -86.6774 },
  SLC: { name: "Salt Lake City", lat: 40.7899, lon: -111.9791 },
  STL: { name: "St. Louis", lat: 38.7487, lon: -90.37 },
  MSY: { name: "New Orleans", lat: 29.9934, lon: -90.258 },
  RDU: { name: "Raleigh-Durham", lat: 35.8801, lon: -78.788 },
  HNL: { name: "Honolulu", lat: 21.3245, lon: -157.9251 },
  LHR: { name: "London Heathrow", lat: 51.47, lon: -0.4543 },
  LGW: { name: "London Gatwick", lat: 51.1537, lon: -0.1821 },
  STN: { name: "London Stansted", lat: 51.885, lon: 0.235 },
  LTN: { name: "London Luton", lat: 51.8747, lon: -0.3683 },
  LCY: { name: "London City", lat: 51.5053, lon: 0.0553 },
  CDG: { name: "Paris Charles de Gaulle", lat: 49.0097, lon: 2.5479 },
  ORY: { name: "Paris Orly", lat: 48.7233, lon: 2.3794 },
  BLR: { name: "Bengaluru", lat: 13.1986, lon: 77.7066 },
  BOM: { name: "Mumbai", lat: 19.0896, lon: 72.8656 },
  DEL: { name: "Delhi", lat: 28.5562, lon: 77.1 },
  PNQ: { name: "Pune", lat: 18.5821, lon: 73.9197 },
  HYD: { name: "Hyderabad", lat: 17.2403, lon: 78.4294 },
  MAA: { name: "Chennai", lat: 12.99, lon: 80.1693 },
};

const EARTH_MILES = 3958.8;
const ROAD_FACTOR = 1.25;
const METERS_PER_MILE = 1609.344;

export function milesBetween(a: LatLon, b: LatLon): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}

const KM_PER_MILE = 1.609344;

export function nearbyAirports(home: LatLon, km = 100): string[] {
  return Object.entries(AIRPORTS)
    .map(([code, a]) => ({ code, km: milesBetween(home, a) * KM_PER_MILE }))
    .filter((a) => a.km <= km)
    .sort((a, b) => a.km - b.km)
    .map((a) => a.code);
}

export type Drive = { miles: number; minutes?: number; source: "road" | "estimate" };

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export async function driveRoute(from: LatLon, to: LatLon, f: typeof fetch = fetch): Promise<Drive> {
  try {
    const u = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await f(u, { signal: AbortSignal.timeout(8000) });
    const route = res.ok ? ((await res.json()) as { routes?: Array<{ distance: number; duration: number }> }).routes?.[0] : undefined;
    if (route) return { miles: oneDecimal(route.distance / METERS_PER_MILE), minutes: Math.round(route.duration / 60), source: "road" };
  } catch {}
  return { miles: oneDecimal(milesBetween(from, to) * ROAD_FACTOR), source: "estimate" };
}

export type Place = LatLon & { name: string; country?: string };

export async function findPlace(name: string, f: typeof fetch = fetch, signal?: AbortSignal): Promise<Place | null> {
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", name);
  u.searchParams.set("count", "1");
  const res = await f(u, { signal: timeoutSignal(10000, signal) });
  if (!res.ok) throw new Error(`geocoding HTTP ${res.status}`);
  const hit = ((await res.json()) as { results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> }).results?.[0];
  return hit ? { name: hit.name, ...(hit.country && { country: hit.country }), lat: hit.latitude, lon: hit.longitude } : null;
}

export async function geocode(place: string, f: typeof fetch = fetch): Promise<LatLon | null> {
  const tries = [...new Set([place, place.split(",")[0]].map((s) => s.trim()).filter(Boolean))];
  for (const name of tries) {
    const hit = await findPlace(name, f).catch(() => null);
    if (hit) return { lat: hit.lat, lon: hit.lon };
  }
  return null;
}
