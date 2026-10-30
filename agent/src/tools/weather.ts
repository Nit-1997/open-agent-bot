import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { WeatherData } from "../render/data.js";
import { findPlace } from "./geo.js";
import { timeoutSignal } from "../lib/net.js";
import { fail, ok, type ToolResult } from "./result.js";
import { withRetry } from "../lib/retry.js";

export function wmoCondition(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "Unknown";
}

type Forecast = {
  current: { temperature_2m: number; weather_code: number };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max?: Array<number | null>;
  };
};

type Archive = {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    weather_code: number[];
  };
};

const FORECAST_DAYS = 16;
const MAX_RANGE_DAYS = 14;
const TYPICAL_YEARS = 3;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const shiftYear = (iso: string, years: number) => {
  const y = Number(iso.slice(0, 4)) - years;
  const md = iso.slice(5);
  return `${y}-${md === "02-29" && !isLeap(y) ? "02-28" : md}`;
};
const latestIso = (...dates: string[]) => [...dates].sort().at(-1)!;
const earliestIso = (...dates: string[]) => [...dates].sort()[0];
const isIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toDate(v).getTime());

function mode<T>(xs: T[]): T {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

type PastDay = { hi: number; lo: number; rain: number; code: number };

function pastDays(archives: Archive[], date: string): PastDay[] {
  const md = date.slice(5);
  return archives.flatMap((a) => {
    const i = a.daily.time.findIndex((t) => t.slice(5) === md);
    const day = {
      hi: a.daily.temperature_2m_max[i],
      lo: a.daily.temperature_2m_min[i],
      rain: a.daily.precipitation_sum[i],
      code: a.daily.weather_code[i],
    };
    return i >= 0 && finite(day.hi) && finite(day.lo)
      ? [{ ...day, rain: finite(day.rain) ? day.rain : 0, code: finite(day.code) ? day.code : -1 }]
      : [];
  });
}

export function weatherTool(deps: { fetch?: typeof fetch; defaultUnits?: "metric" | "imperial"; today?: () => string } = {}) {
  const f = withRetry(deps.fetch ?? fetch);
  const today = deps.today ?? (() => toIso(new Date()));
  return defineTool({
    name: "weather",
    label: "Weather",
    description: `Weather for a place. Use it only when the user asks about weather or the plan depends on being outdoors (travel, an outdoor event or activity); it always shows a card. Without dates: current conditions and the next few days. With start_date/end_date (YYYY-MM-DD, up to ${MAX_RANGE_DAYS} days): the forecast for those dates if they are within ${FORECAST_DAYS} days, otherwise typical weather for those dates averaged over the last ${TYPICAL_YEARS} years (not a forecast; say so). The weather card is shown to the user automatically. Afterwards, add a one or two sentence summary.`,
    parameters: Type.Object({
      location: Type.String({ minLength: 1, description: "city or place name" }),
      days: Type.Optional(Type.Number({ description: "1-7, default 3; ignored when dates are given" })),
      start_date: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      end_date: Type.Optional(Type.String({ description: "YYYY-MM-DD, defaults to start_date" })),
      units: Type.Optional(Type.Enum(["metric", "imperial"])),
    }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const units = params.units ?? deps.defaultUnits ?? "metric";
      const deg = units === "imperial" ? "°F" : "°C";
      const opts = { signal: timeoutSignal(15000, signal) };

      let range: { start: string; end: string } | undefined;
      if (params.start_date !== undefined) {
        const start = params.start_date;
        const end = params.end_date ?? start;
        if (!isIso(start) || !isIso(end)) return fail("start_date and end_date must be YYYY-MM-DD");
        if (daysBetween(start, end) < 0) return fail("end_date is before start_date");
        if (daysBetween(start, end) >= MAX_RANGE_DAYS) return fail(`ask for at most ${MAX_RANGE_DAYS} days at a time`);
        range = { start, end };
      }

      try {
        const place = await findPlace(params.location, f, signal);
        if (!place) return fail(`no location found for "${params.location}"`);
        const location = [place.name, place.country].filter(Boolean).join(", ");

        const lastForecastDay = addDays(today(), FORECAST_DAYS - 1);
        if (range && range.start > lastForecastDay) {
          const years = Array.from({ length: TYPICAL_YEARS }, (_, i) => i + 1);
          const archives = await Promise.all(
            years.map(async (back) => {
              const u = new URL("https://archive-api.open-meteo.com/v1/archive");
              u.searchParams.set("latitude", String(place.lat));
              u.searchParams.set("longitude", String(place.lon));
              u.searchParams.set("start_date", shiftYear(range.start, back));
              u.searchParams.set("end_date", shiftYear(range.end, back));
              u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code");
              u.searchParams.set("timezone", "auto");
              if (units === "imperial") {
                u.searchParams.set("temperature_unit", "fahrenheit");
                u.searchParams.set("precipitation_unit", "inch");
              }
              const res = await f(u, opts);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return (await res.json()) as Archive;
            }),
          );
          const span = daysBetween(range.start, range.end) + 1;
          const days = Array.from({ length: span }, (_, i) => addDays(range.start, i)).flatMap((date) => {
            const at = pastDays(archives, date);
            if (!at.length) return [];
            return [
              {
                date,
                high: avg(at.map((x) => x.hi)),
                low: avg(at.map((x) => x.lo)),
                condition: mode(at.map((x) => wmoCondition(x.code))),
                precipChance: Math.round((100 * at.filter((x) => x.rain > 0).length) / at.length),
              },
            ];
          });
          if (!days.length) return fail(`no past weather data for ${location} on those dates`);
          const data: WeatherData = {
            kind: "weather",
            mode: "typical",
            basis: `${Number(range.start.slice(0, 4)) - TYPICAL_YEARS}–${Number(range.start.slice(0, 4)) - 1}`,
            location,
            units,
            days,
            source: "https://open-meteo.com",
          };
          const summary = [
            `Typical weather (not a forecast) for ${location}, ${range.start} to ${range.end}, averaged over ${data.basis}. A real forecast is only available within ${FORECAST_DAYS} days.`,
            ...data.days.map(
              (d) => `${d.date}: ${d.low}–${d.high}${deg}, usually ${d.condition}, rain in ${d.precipChance}% of past years`,
            ),
          ].join("\n");
          return ok(summary, { data });
        }

        const u = new URL("https://api.open-meteo.com/v1/forecast");
        u.searchParams.set("latitude", String(place.lat));
        u.searchParams.set("longitude", String(place.lon));
        u.searchParams.set("current", "temperature_2m,weather_code");
        u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max");
        u.searchParams.set("timezone", "auto");
        if (range) {
          u.searchParams.set("start_date", latestIso(range.start, today()));
          u.searchParams.set("end_date", earliestIso(range.end, lastForecastDay));
        } else {
          u.searchParams.set("forecast_days", String(Math.min(Math.max(Math.floor(params.days ?? 3), 1), 7)));
        }
        if (units === "imperial") u.searchParams.set("temperature_unit", "fahrenheit");
        const res = await f(u, opts);
        if (!res.ok) return fail(`weather service error: HTTP ${res.status}`);
        const fc = (await res.json()) as Forecast;

        const data: WeatherData = {
          kind: "weather",
          mode: "forecast",
          location,
          units,
          current: { temp: fc.current.temperature_2m, condition: wmoCondition(fc.current.weather_code) },
          days: fc.daily.time.map((date, i) => ({
            date,
            high: fc.daily.temperature_2m_max[i],
            low: fc.daily.temperature_2m_min[i],
            condition: wmoCondition(fc.daily.weather_code[i]),
            ...(fc.daily.precipitation_probability_max?.[i] != null ? { precipChance: fc.daily.precipitation_probability_max[i]! } : {}),
          })),
          source: "https://open-meteo.com",
        };
        const summary = [
          `${data.location}: now ${data.current!.temp}${deg}, ${data.current!.condition}`,
          ...data.days.map(
            (d) => `${d.date}: ${d.low}–${d.high}${deg}, ${d.condition}${d.precipChance != null ? `, ${d.precipChance}% rain` : ""}`,
          ),
        ].join("\n");
        return ok(summary, { data });
      } catch (err) {
        return fail(`weather lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
