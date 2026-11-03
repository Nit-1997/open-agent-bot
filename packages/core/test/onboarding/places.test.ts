import { describe, expect, it } from "vitest";
import { searchPlaces } from "../../src/onboarding/places.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const feature = (properties: Record<string, string>, lon: number, lat: number) => ({ properties, geometry: { coordinates: [lon, lat] } });

const photon = (features: unknown[]) => fakeFetch([[/photon\.komoot\.io\/api/, () => json({ features })]]);

describe("searchPlaces", () => {
  it("turns Photon features into labeled places with city, region, country code and lat/lon", async () => {
    const f = photon([
      feature(
        {
          housenumber: "555",
          street: "California Street",
          name: "555 California Street",
          city: "San Francisco",
          state: "California",
          country: "United States",
          countrycode: "US",
          type: "house",
        },
        -122.4037,
        37.7921,
      ),
      feature({ name: "Madrid", type: "city", state: "Community of Madrid", country: "Spain", countrycode: "ES" }, -3.7, 40.4),
    ]);
    expect(await searchPlaces("555 Cali", f)).toEqual([
      {
        label: "555 California Street, San Francisco, California, United States",
        city: "San Francisco",
        region: "California",
        country: "US",
        lat: 37.7921,
        lon: -122.4037,
      },
      { label: "Madrid, Community of Madrid, Spain", city: "Madrid", region: "Community of Madrid", country: "ES", lat: 40.4, lon: -3.7 },
    ]);
    const url = new URL(f.calls[0]);
    expect(url.searchParams.get("q")).toBe("555 Cali");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("asks Photon nothing under 3 characters", async () => {
    const f = photon([]);
    expect(await searchPlaces(" sa ", f)).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("returns no suggestions rather than failing when Photon is down or returns junk", async () => {
    expect(await searchPlaces("Paris", fakeFetch([[/photon/, () => new Response("busy", { status: 503 })]]))).toEqual([]);
    expect(await searchPlaces("Paris", fakeFetch([[/photon/, () => new Response("<html>")]]))).toEqual([]);
    expect(await searchPlaces("Paris", photon([{ properties: { name: "x" } }]))).toEqual([]);
    const throwing = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    expect(await searchPlaces("Paris", throwing)).toEqual([]);
  });

  it("keeps at most five unique places", async () => {
    const many = Array.from({ length: 8 }, (_, i) => feature({ name: `Town ${i % 6}`, type: "town", countrycode: "us" }, 0, i));
    const places = await searchPlaces("Town", photon(many));
    expect(places.map((p) => p.label)).toEqual(["Town 0", "Town 1", "Town 2", "Town 3", "Town 4"]);
    expect(places[0].country).toBe("US");
  });
});
