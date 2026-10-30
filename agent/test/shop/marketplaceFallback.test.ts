import { describe, expect, it } from "vitest";
import type { Tile } from "../../src/shop/extract.js";
import type { Store } from "../../src/shop/stores.js";
import { ActiveCart } from "../../src/shop/cart.js";
import { type Job, type JobResult, shopTool } from "../../src/tools/shop.js";

const target: Store = { id: "target", label: "Target", home: "https://www.target.com/", searchUrl: (q) => `https://www.target.com/s?searchTerm=${q}` };
const walmart: Store = { id: "walmart", label: "Walmart", home: "https://www.walmart.com/", searchUrl: (q) => `https://www.walmart.com/search?q=${q}` };
const shipt: Store = { id: "shipt", label: "Shipt", home: "https://www.shipt.com/", searchUrl: (q) => `https://www.shipt.com/s?q=${q}`, marketplace: true };
const STORES: Record<string, Store> = { target, walmart, shipt };
const tile = (title: string, group: string, price: number): Tile => ({ title, price, priceText: `$${price}`, url: `https://www.shipt.com/p/${group}/${title}`, sponsored: false, group });

function setup(blocked: string[]) {
  const searched: string[] = [];
  const search = async (jobs: Job[]): Promise<JobResult[]> =>
    jobs.map((j) => {
      searched.push(`${j.store.id}:${j.item.query}`);
      if (blocked.includes(j.store.id)) return { store: j.store, item: j.item, tiles: [], blocked: j.store.home };
      if (j.store.id === "shipt") return { store: j.store, item: j.item, tiles: [tile(j.item.query, "Target", 4), tile(j.item.query, "Safeway", 3)] };
      return { store: j.store, item: j.item, tiles: [tile(j.item.query, "", 5)] };
    });
  const cart = new ActiveCart();
  const shop = shopTool({ pool: {} as never, threadId: "t", userContext: null, region: "US", storeFor: (n) => STORES[n], cart, search });
  const call = async (p: object) => {
    const r = await shop.execute("c", p as never, undefined, undefined, {} as never);
    return { text: (r.content[0] as { text: string }).text, stores: (r.details as { data: { stores: { store: string }[] } }).data.stores.map((s) => s.store) };
  };
  return { call, searched, cart };
}

describe("a named store that blocks guests", () => {
  it("is read through the region's grocery marketplace, keeping only that store", async () => {
    const { call, searched } = setup(["target"]);
    const r = await call({ stores: ["target"], items: [{ query: "pizza", qty: 2 }] });
    expect(searched).toEqual(["target:pizza", "shipt:pizza"]);
    expect(r.stores).toEqual(["Target (Shipt)"]);
    expect(r.text).toContain("Target blocked direct browsing, so its prices were read through Shipt");
    expect(r.text).not.toContain("Safeway");
  });

  it("keeps using the marketplace for later additions", async () => {
    const { call, searched } = setup(["target"]);
    await call({ stores: ["target"], items: [{ query: "pizza", qty: 2 }] });
    const r = await call({ items: [{ query: "cake", qty: 1 }] });
    expect(searched.slice(2)).toEqual(["shipt:cake"]);
    expect(r.stores).toEqual(["Target (Shipt)"]);
  });

  it("never swaps in a different store when the marketplace doesn't carry it", async () => {
    const { call, searched } = setup(["walmart"]);
    const r = await call({ stores: ["walmart"], items: [{ query: "pizza", qty: 2 }] });
    expect(searched).toEqual(["walmart:pizza", "shipt:pizza"]);
    expect(r.stores).toEqual([]);
    expect(r.text).toContain("Walmart: blocked");
  });

  it("does nothing extra when the store answered", async () => {
    const { call, searched } = setup([]);
    await call({ stores: ["target"], items: [{ query: "pizza", qty: 2 }] });
    expect(searched).toEqual(["target:pizza"]);
  });
});
