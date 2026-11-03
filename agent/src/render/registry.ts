import { validateWidget, type WidgetPayload } from "@oab/shared/widgets";
import { MAX_CART_STORES, toCartStore } from "./cart.js";
import type { FlightsData, StaysData, WeatherData } from "./data.js";

const MAX_FLIGHTS = 8;
const MAX_COMPARED_FLIGHTS = 24;

type ShopData = {
  stores: Array<{ store: string; home?: string; items: Array<{ query: string; qty: number; picks: Array<Record<string, unknown>> }> }>;
  summary: Array<{ store: string; total: number; missing: string[] }>;
};

const renderers: Record<string, (data: any) => unknown> = {
  shop: (d: ShopData) => {
    if (!d.summary.length) return null;
    return {
      kind: "cart",
      stores: d.summary.slice(0, MAX_CART_STORES).map((sum) => toCartStore(d.stores.find((x) => x.store === sum.store)!, sum)),
    };
  },
  stays: (d: StaysData) => ({
    kind: "stay_list",
    location: d.location,
    checkin: d.checkin,
    checkout: d.checkout,
    nights: d.nights,
    adults: d.adults,
    currency: d.currency,
    ...(d.maxNightly != null && { maxNightly: d.maxNightly }),
    sources: d.sources.map((s) => ({ id: s.id, label: s.label, site: s.site, url: s.url, status: s.status, stays: s.stays.slice(0, 10) })),
  }),
  weather: (d: WeatherData) => ({
    kind: "weather_card",
    mode: d.mode,
    ...(d.basis && { basis: d.basis }),
    location: d.location,
    units: d.units,
    ...(d.current && { current: d.current }),
    days: d.days,
    source: d.source,
  }),
  flights: (d: FlightsData) => ({
    kind: "flight_list",
    from: d.from,
    to: d.to,
    date: d.date,
    currency: d.currency,
    flights: d.options.slice(0, d.airports.length > 1 ? MAX_COMPARED_FLIGHTS : MAX_FLIGHTS),
    ...(d.airports.length > 1 && { airports: d.airports }),
    ...((d.prefs.maxLayover || d.prefs.times) && { prefs: d.prefs }),
    ...(d.returnDate && { returnDate: d.returnDate }),
    ...(d.priceNote && { priceNote: d.priceNote }),
    searchUrl: d.searchUrl,
    source: d.source,
  }),
};

export function renderData(data: unknown): WidgetPayload | null {
  const kind = (data as { kind?: unknown } | null | undefined)?.kind;
  if (typeof kind !== "string" || !(kind in renderers)) return null;
  let candidate: unknown;
  try {
    candidate = renderers[kind](data);
  } catch {
    return null;
  }
  const r = validateWidget(candidate);
  return r.ok ? r.value : null;
}
