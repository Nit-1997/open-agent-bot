import { validateWidget, type WidgetPayload } from "../../../shared/widgets.js";
import type { FlightsData, WeatherData } from "../tools/data.js";

const MAX_FLIGHTS = 8;

const renderers: Record<string, (data: any) => unknown> = {
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
    flights: d.options.slice(0, MAX_FLIGHTS),
    ...(d.airports.length > 1 && { airports: d.airports.map(({ options: _o, ...a }) => a) }),
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
