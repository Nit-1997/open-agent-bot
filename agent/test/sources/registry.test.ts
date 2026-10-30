import { describe, expect, it } from "vitest";
import { createRegistry } from "../../src/sources/index.js";
import { SourceRegistry } from "../../src/sources/registry.js";
import { resolveStore } from "../../src/sources/retail/resolve.js";
import type { RetailSource } from "../../src/sources/retail/types.js";
import { staySource } from "../../src/sources/stays/define.js";
import { mockStore } from "./fixtures/mockStore.js";

const ids = (list: Array<{ id: string }>) => list.map((s) => s.id);

describe("SourceRegistry", () => {
  it("selects by vertical, region and capability, with * matching any region", () => {
    const r = createRegistry();
    expect(ids(r.select({ vertical: "retail", region: "IN" }))).toEqual(["amazon", "amazon.in", "flipkart"]);
    expect(ids(r.select({ vertical: "retail", region: "gb" }))).toEqual(["amazon", "amazon.co.uk"]);
    expect(ids(r.select({ vertical: "retail", region: "US", capability: "grocery" }))).toEqual(["shipt", "kroger", "safeway"]);
    expect(ids(r.select({ vertical: "stays", region: "FR", capability: "rental" }))).toEqual(["google_hotels", "airbnb", "booking", "expedia"]);
    expect(ids(r.select({ vertical: "flights" }))).toEqual(["google_flights"]);
  });

  it("picks defaults by region and kind, falling back to *", () => {
    const r = createRegistry();
    const d = (region: string, kind?: string) => ids(r.defaults({ vertical: "retail", region, kind }));
    expect(d("US", "grocery")).toEqual(["shipt"]);
    expect(d("US", "general")).toEqual(["amazon", "target"]);
    expect(d("IN", "general")).toEqual(["amazon.in", "flipkart"]);
    expect(d("GB", "grocery")).toEqual(["amazon.co.uk"]);
    expect(d("CA", "general")).toEqual(["amazon"]);
  });

  it("replaces a source registered twice under the same id", () => {
    const r = new SourceRegistry();
    r.register(mockStore);
    r.register({ ...mockStore, label: "Again" } as RetailSource);
    expect(r.select({ vertical: "retail" })).toHaveLength(1);
  });

  it("adding a store is one registered source: it is selected for its region and resolvable by domain", async () => {
    const r = createRegistry();
    expect(ids(r.select({ vertical: "retail", region: "NZ" }))).toEqual(["amazon"]);
    r.register(mockStore);
    expect(ids(r.select({ vertical: "retail", region: "NZ" }))).toEqual(["amazon", "mockmart"]);
    expect(ids(r.defaults({ vertical: "retail", region: "NZ", kind: "general" }))).toEqual(["mockmart"]);
    const store = resolveStore(r, "https://www.mockmart.test/x") as RetailSource;
    expect(store.id).toBe("mockmart");
    expect((await store.search({ query: "tea" }, {})).tiles[0].title).toBe("tea at Mock Mart");
    expect(ids(createRegistry().select({ vertical: "retail", region: "NZ" }))).toEqual(["amazon"]);
  });

  it("builds a stay source with region and capabilities from its definition", () => {
    const s = staySource({ id: "x", label: "X", site: "x.test", lists: ["hotel"], searchUrl: () => "https://x.test/" });
    expect(s).toMatchObject({ vertical: "stays", regions: ["*"], capabilities: ["hotel"] });
  });
});

describe("resolveStore", () => {
  const r = createRegistry();
  const id = (s: string, jsonld = false) => resolveStore(r, s, { jsonld }).id;

  it("keeps regional Amazon domains apart", () => {
    expect(id("amazon.in")).toBe("amazon.in");
    expect(id("https://www.amazon.in/s?k=x")).toBe("amazon.in");
    expect(id("amazon.co.uk")).toBe("amazon.co.uk");
    expect(id("amazon.com")).toBe("amazon");
    expect(id("Amazon")).toBe("amazon");
    expect(id("flipkart.com")).toBe("flipkart");
  });

  it("does not fold an unknown regional domain into a known store", () => {
    expect(id("amazon.ca")).toBe("amazon.ca");
    expect(id("bestbuy.ca")).toBe("bestbuy.ca");
    expect(id("Best Buy")).toBe("bestbuy");
  });

  it("gives unknown domains the structured-data reader", () => {
    const s = resolveStore(r, "newegg.com");
    expect(s).toMatchObject({ id: "newegg.com", home: "https://www.newegg.com/" });
    expect(s.search).toBeTypeOf("function");
  });
});
