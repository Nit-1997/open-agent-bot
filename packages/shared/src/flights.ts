export type LayoverPref = "nonstop" | "5h" | "10h" | "any";
export type TimeBucket = "early_morning" | "midday" | "evening" | "late_night";
export type FlightPrefs = { maxLayover?: LayoverPref; times?: TimeBucket[] };

export const LAYOVER_OPTIONS: Array<{ id: LayoverPref; label: string }> = [
  { id: "nonstop", label: "Nonstop" },
  { id: "5h", label: "Up to 5h" },
  { id: "10h", label: "Up to 10h" },
  { id: "any", label: "Any" },
];

export const TIME_OPTIONS: Array<{ id: TimeBucket; label: string; hint: string }> = [
  { id: "early_morning", label: "Early morning", hint: "4–9 am" },
  { id: "midday", label: "Midday", hint: "9 am–4 pm" },
  { id: "evening", label: "Evening", hint: "4–10 pm" },
  { id: "late_night", label: "Late night", hint: "10 pm–4 am" },
];

const LAYOVER_LIMIT: Record<LayoverPref, number> = { nonstop: 0, "5h": 300, "10h": 600, any: Infinity };

export const RIDE_BASE = 9;
export const RIDE_PER_MILE = 2.3;

export function rideOneWay(roadMiles: number): number {
  return Math.round(RIDE_BASE + RIDE_PER_MILE * roadMiles);
}

export function departMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])?\.?m?\.?/i.exec(time.trim());
  if (!m) return null;
  let h = Number(m[1]) % 24;
  const ampm = m[3]?.toLowerCase();
  if (ampm === "p" && h < 12) h += 12;
  if (ampm === "a" && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

export function departBucket(time: string): TimeBucket | null {
  const mins = departMinutes(time);
  if (mins == null) return null;
  const h = mins / 60;
  if (h >= 4 && h < 9) return "early_morning";
  if (h >= 9 && h < 16) return "midday";
  if (h >= 16 && h < 22) return "evening";
  return "late_night";
}

type FlightLike = { departTime: string; stops: number; layoverMinutes?: number };

export function matchesPrefs(f: FlightLike, prefs: FlightPrefs): boolean {
  const limit = LAYOVER_LIMIT[prefs.maxLayover ?? "any"];
  if (limit === 0 && f.stops > 0) return false;
  if (f.stops > 0 && f.layoverMinutes != null && f.layoverMinutes > limit) return false;
  if (prefs.times?.length) {
    const b = departBucket(f.departTime);
    if (!b || !prefs.times.includes(b)) return false;
  }
  return true;
}

type AirportLike = { code: string; status: "ok" | "failed"; rideOneWay?: number; driveMinutes?: number };
export type RankedAirport<A extends AirportLike> = A & {
  bestFare?: number;
  total?: number;
  bestValue?: boolean;
  closest?: boolean;
  noMatch?: boolean;
};

export function rankAirports<A extends AirportLike>(
  airports: A[],
  flights: Array<FlightLike & { origin?: string; price?: number }>,
  prefs: FlightPrefs,
): RankedAirport<A>[] {
  const ranked = airports.map((a): RankedAirport<A> => {
    const { bestFare: _b, total: _t, bestValue: _v, closest: _c, noMatch: _n, ...base } = a as RankedAirport<A>;
    if (a.status !== "ok") return base as RankedAirport<A>;
    const fares = flights.filter((f) => f.origin === a.code && f.price != null && matchesPrefs(f, prefs)).map((f) => f.price!);
    if (!fares.length) return { ...(base as A), noMatch: true };
    const bestFare = Math.min(...fares);
    return { ...(base as A), bestFare, total: bestFare + 2 * (a.rideOneWay ?? 0) };
  });
  const order = (a: RankedAirport<A>) => (a.total != null ? 0 : a.status === "ok" ? 1 : 2);
  ranked.sort((a, b) => order(a) - order(b) || (a.total ?? 0) - (b.total ?? 0));
  if (ranked[0]?.total != null) ranked[0].bestValue = true;
  const drives = ranked.filter((a) => a.status === "ok" && a.driveMinutes != null);
  if (drives.length) drives.reduce((m, a) => (a.driveMinutes! < m.driveMinutes! ? a : m)).closest = true;
  return ranked;
}
