import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { WeatherData } from "./data.js";
import { fail, ok, type ToolResult } from "./result.js";

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

export function weatherTool(deps: { fetch?: typeof fetch; defaultUnits?: "metric" | "imperial" } = {}) {
  const f = deps.fetch ?? fetch;
  return defineTool({
    name: "weather",
    label: "Weather",
    description:
      "Current weather and daily forecast for a place. The weather card is shown to the user automatically. Afterwards, add a one or two sentence summary.",
    parameters: Type.Object({
      location: Type.String({ minLength: 1, description: "city or place name" }),
      days: Type.Optional(Type.Number({ description: "1-7, default 3" })),
      units: Type.Optional(Type.Enum(["metric", "imperial"])),
    }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const days = Math.min(Math.max(Math.floor(params.days ?? 3), 1), 7);
      const units = params.units ?? deps.defaultUnits ?? "metric";
      const opts = { signal: signal ?? AbortSignal.timeout(15000) };
      try {
        const g = new URL("https://geocoding-api.open-meteo.com/v1/search");
        g.searchParams.set("name", params.location);
        g.searchParams.set("count", "1");
        const geo = (await (await f(g, opts)).json()) as {
          results?: Array<{ name: string; country?: string; admin1?: string; latitude: number; longitude: number }>;
        };
        const place = geo.results?.[0];
        if (!place) return fail(`no location found for "${params.location}"`);

        const u = new URL("https://api.open-meteo.com/v1/forecast");
        u.searchParams.set("latitude", String(place.latitude));
        u.searchParams.set("longitude", String(place.longitude));
        u.searchParams.set("current", "temperature_2m,weather_code");
        u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max");
        u.searchParams.set("timezone", "auto");
        u.searchParams.set("forecast_days", String(days));
        if (units === "imperial") u.searchParams.set("temperature_unit", "fahrenheit");
        const res = await f(u, opts);
        if (!res.ok) return fail(`weather service error: HTTP ${res.status}`);
        const fc = (await res.json()) as Forecast;

        const data: WeatherData = {
          kind: "weather",
          location: [place.name, place.country].filter(Boolean).join(", "),
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
        const deg = units === "imperial" ? "°F" : "°C";
        const summary = [
          `${data.location}: now ${data.current.temp}${deg}, ${data.current.condition}`,
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
