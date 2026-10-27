import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
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

  it("weather details validate as weather_card", async () => {
    const f = routes();
    const r = await weatherTool({ fetch: f }).execute("c", { location: "Pune", days: 2 }, undefined, undefined, {} as never);
    const widget = (r.details as { widget: unknown }).widget;
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

  it("weather unknown location message", async () => {
    const f = fakeFetch([[/geocoding-api/, () => json({})]]);
    const r = await weatherTool({ fetch: f }).execute("c", { location: "Atlantis" }, undefined, undefined, {} as never);
    expect(r.isError).toBe(true);
    expect((r.content[0] as { text: string }).text).toBe('no location found for "Atlantis"');
  });
});
