import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { renderData } from "../../src/render/registry.js";
import { weatherTool, wmoCondition } from "../../src/tools/weather.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const geo = json({ results: [{ name: "Pune", country: "India", latitude: 18.52, longitude: 73.86 }] });
const forecast = json({
  current: { temperature_2m: 27.4, weather_code: 1 },
  daily: {
    time: ["2026-10-31", "2026-11-01"],
    temperature_2m_max: [31.2, 30.1],
    temperature_2m_min: [19.5, 18.9],
    weather_code: [61, 0],
    precipitation_probability_max: [60, 5],
  },
});

const routes = () =>
  fakeFetch([
    [/geocoding-api/, () => geo.clone()],
    [/api\.open-meteo\.com\/v1\/forecast/, () => forecast.clone()],
  ]);

describe("weather", () => {
  it('weather maps WMO code 61 to "Rain"', () => {
    expect(wmoCondition(61)).toBe("Rain");
    expect(wmoCondition(0)).toBe("Clear");
  });

  it("weather data renders as a valid weather_card", async () => {
    const f = routes();
    const r = await weatherTool({ fetch: f }).execute("c", { location: "Pune", days: 2 }, undefined, undefined, {} as never);
    const data = (r.details as { data: { kind: string } }).data;
    expect(data.kind).toBe("weather");
    const widget = renderData(data);
    expect(validateWidget(widget)).toMatchObject({ ok: true });
    expect(widget).toMatchObject({ location: "Pune, India", units: "metric", current: { temp: 27.4 }, days: [{ condition: "Rain", precipChance: 60 }, {}] });
    const fc = new URL(f.calls[1]);
    expect(fc.searchParams.get("forecast_days")).toBe("2");
    expect(fc.searchParams.get("timezone")).toBe("auto");
  });

  it("requests fahrenheit for imperial units", async () => {
    const f = routes();
    await weatherTool({ fetch: f }).execute("c", { location: "Pune", units: "imperial" }, undefined, undefined, {} as never);
    expect(new URL(f.calls[1]).searchParams.get("temperature_unit")).toBe("fahrenheit");
  });

  it("defaults to the user's region units when the model doesn't say", async () => {
    const f = routes();
    await weatherTool({ fetch: f, defaultUnits: "imperial" }).execute("c", { location: "Sunnyvale" }, undefined, undefined, {} as never);
    expect(new URL(f.calls[1]).searchParams.get("temperature_unit")).toBe("fahrenheit");
  });

  it("weather unknown location message", async () => {
    const f = fakeFetch([[/geocoding-api/, () => json({})]]);
    const r = await weatherTool({ fetch: f }).execute("c", { location: "Atlantis" }, undefined, undefined, {} as never);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe('no location found for "Atlantis"');
  });

  describe("specific dates", () => {
    const today = () => "2026-10-27";
    const exec = (f: typeof fetch, params: Record<string, unknown>) =>
      weatherTool({ fetch: f, today, defaultUnits: "imperial" }).execute("c", { location: "Las Vegas", ...params } as never, undefined, undefined, {} as never);

    it("asks the forecast for exactly those dates when they are within 16 days", async () => {
      const f = routes();
      await exec(f, { start_date: "2026-11-05", end_date: "2026-11-07" });
      const fc = new URL(f.calls[1]);
      expect(fc.searchParams.get("start_date")).toBe("2026-11-05");
      expect(fc.searchParams.get("end_date")).toBe("2026-11-07");
      expect(fc.searchParams.get("forecast_days")).toBeNull();
    });

    it("returns typical weather from the last three years when the dates are too far out", async () => {
      const year = (y: number, hi: number, rain: number, code: number) =>
        json({
          daily: {
            time: [`${y}-11-25`, `${y}-11-26`],
            temperature_2m_max: [hi, hi + 2],
            temperature_2m_min: [hi - 20, hi - 18],
            precipitation_sum: [rain, 0],
            weather_code: [code, 0],
          },
        });
      const f = fakeFetch([
        [/geocoding-api/, () => geo.clone()],
        [/archive-api.*start_date=2025/, () => year(2025, 60, 0.2, 61)],
        [/archive-api.*start_date=2024/, () => year(2024, 62, 0, 0)],
        [/archive-api.*start_date=2023/, () => year(2023, 64, 0.1, 61)],
      ]);
      const r = await exec(f, { start_date: "2026-11-25", end_date: "2026-11-26" });
      expect(f.calls.some((c) => c.includes("/v1/forecast"))).toBe(false);
      const data = (r.details as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({ mode: "typical", basis: "2023–2025", units: "imperial" });
      expect(data.current).toBeUndefined();
      expect(data.days).toEqual([
        { date: "2026-11-25", high: 62, low: 42, condition: "Rain", precipChance: 67 },
        { date: "2026-11-26", high: 64, low: 44, condition: "Clear", precipChance: 0 },
      ]);
      expect((r.content[0] as { text: string }).text).toMatch(/^Typical weather \(not a forecast\)/);
      expect(validateWidget(renderData(data as never))).toMatchObject({ ok: true });
    });

    it("rejects a range that ends before it starts or runs longer than 14 days", async () => {
      expect((await exec(routes(), { start_date: "2026-11-10", end_date: "2026-11-01" })).isError).toBe(true);
      expect((await exec(routes(), { start_date: "2026-11-01", end_date: "2026-12-01" })).isError).toBe(true);
    });
  });
});
