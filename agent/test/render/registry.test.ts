import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { renderData } from "../../src/render/registry.js";
import { parseGoogleFlights } from "../../src/tools/flights.js";

describe("renderData", () => {
  it("renders weather data as a weather_card", () => {
    const w = renderData({
      kind: "weather",
      location: "Pune, India",
      units: "metric",
      current: { temp: 27, condition: "Clear" },
      days: [{ date: "2026-10-31", high: 31, low: 19, condition: "Rain", precipChance: 60 }],
      source: "https://open-meteo.com",
    });
    expect(w?.kind).toBe("weather_card");
    expect(validateWidget(w).ok).toBe(true);
  });

  it("renders flights data as a flight_list, capped at 8 options", () => {
    const page = readFileSync(new URL("../fixtures/google-flights-sfo-bna.txt", import.meta.url), "utf8");
    const options = parseGoogleFlights(page);
    const many = Array.from({ length: 12 }, () => options[0]);
    const w = renderData({ kind: "flights", from: "SFO", to: "BNA", date: "2026-12-12", currency: "USD", options: many, searchUrl: "https://g.co/x", source: "Google Flights" });
    expect(w?.kind).toBe("flight_list");
    expect(validateWidget(w).ok).toBe(true);
    expect((w as { flights: unknown[] }).flights).toHaveLength(8);
  });

  it("returns null for unknown or malformed data", () => {
    expect(renderData({ kind: "search_results" })).toBeNull();
    expect(renderData({ kind: "weather" })).toBeNull();
    expect(renderData(undefined)).toBeNull();
  });
});
