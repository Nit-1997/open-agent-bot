import { describe, expect, it } from "vitest";
import { nearbyGroceries, rankBrands } from "../../src/onboarding/groceries.js";
import { onboardingOptions } from "../../src/onboarding/options.js";
import { createRegistry } from "../../src/sources/index.js";
import { staySource } from "../../src/sources/stays/define.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

const shops = (...names: string[]) => ({ elements: names.map((brand) => ({ tags: { brand } })) });

describe("nearbyGroceries", () => {
  it("groups supermarkets by brand and ranks them by how many are nearby", async () => {
    const f = fakeFetch([[/overpass/, () => json(shops("Safeway", "Trader Joe's", "Safeway", "Whole Foods", "Safeway", "Trader Joe's"))]]);
    expect(await nearbyGroceries({ lat: 1.11, lon: 2.22 }, { fetch: f, endpoints: ["https://overpass.test/api"] })).toEqual([
      "Safeway",
      "Trader Joe's",
      "Whole Foods",
    ]);
    expect(new URL(f.calls[0]).searchParams.get("data")).toContain('"shop"="supermarket"');
  });

  it("gives up after the time budget so onboarding falls back to the curated list", async () => {
    const slow = (async (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const started = Date.now();
    expect(
      await nearbyGroceries({ lat: 3.33, lon: 4.44 }, { fetch: slow, timeoutMs: 50, endpoints: ["https://overpass.test/api"] }),
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("returns null when every Overpass server is busy", async () => {
    const busy = fakeFetch([[/overpass/, () => new Response("at capacity", { status: 502 })]]);
    expect(
      await nearbyGroceries({ lat: 5.55, lon: 6.66 }, { fetch: busy, endpoints: ["https://overpass.a/api", "https://overpass.b/api"] }),
    ).toBeNull();
  });

  it("ignores unnamed shops", () => {
    expect(rankBrands([{ tags: {} }, { tags: { name: "Corner Mart" } }, {}])).toEqual(["Corner Mart"]);
  });
});

describe("onboardingOptions", () => {
  it("uses nearby stores first and pads with the country's curated list", async () => {
    const opts = await onboardingOptions(
      { lat: 37.79, lon: -122.4, country: "US" },
      { registry: createRegistry(), groceries: async () => ["Safeway", "Mollie Stone's"] },
    );
    expect(opts.groceriesNearby).toBe(true);
    expect(opts.rows.groceries).toEqual(["Safeway", "Mollie Stone's", "Trader Joe's", "Whole Foods", "Costco", "Kroger"]);
  });

  it("falls back to the curated list when Overpass fails", async () => {
    const opts = await onboardingOptions(
      { lat: 19.07, lon: 72.87, country: "IN" },
      { registry: createRegistry(), groceries: async () => null },
    );
    expect(opts.groceriesNearby).toBe(false);
    expect(opts).toMatchObject({ currency: "INR", units: "metric", airports: ["BOM"] });
    expect(opts.rows.groceries[0]).toBe("BigBasket");
    expect(opts.rows.airlines).toContain("IndiGo");
  });

  it("uses the generic list for a country without its own entries", async () => {
    const opts = await onboardingOptions({ country: "KE" }, { registry: createRegistry() });
    expect(opts.rows.airlines).toContain("Emirates");
    expect(opts.airports).toEqual([]);
  });

  it("marks travel sites searched or linked from the source registry, so a new reader shows up on its own", async () => {
    const registry = createRegistry();
    const before = await onboardingOptions({ country: "US" }, { registry });
    expect(before.rows.sites.slice(0, 4).every((c) => c.access === "searched")).toBe(true);
    expect(before.rows.sites).toContainEqual({ label: "Google Flights", access: "searched" });
    expect(before.rows.sites).toContainEqual({ label: "Expedia", access: "linked" });
    expect(before.rows.sites).toContainEqual({ label: "Vrbo", access: "linked" });
    registry.register(
      staySource({
        id: "vrbo",
        label: "Vrbo",
        site: "vrbo.com",
        lists: ["rental"],
        searchUrl: () => "https://vrbo.com",
        read: async () => [],
      }),
    );
    const after = await onboardingOptions({ country: "US" }, { registry });
    expect(after.rows.sites).toContainEqual({ label: "Vrbo", access: "searched" });
    expect(after.rows.sites.filter((c) => c.label === "Vrbo")).toHaveLength(1);
  });
});
