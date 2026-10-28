import { describe, expect, it } from "vitest";
import type { Tile } from "../../src/shop/extract.js";
import { bestValue, rankTiles } from "../../src/shop/rank.js";

const tile = (title: string, price?: number, extra: Partial<Tile> = {}): Tile => ({ title, price, url: `https://s.com/${encodeURIComponent(title)}`, sponsored: false, ...extra });

describe("rankTiles", () => {
  it("keeps only products that match the query, unsponsored first, then cheaper", () => {
    const tiles = [
      tile("Heyday Black Bean Enchilada Sauce", 5.99, { sponsored: true }),
      tile("Taco Seasoning Mix", 1.29),
      tile("Bush's Black Beans 15 oz", 1.69),
      tile("Good & Gather Black Beans 15.5 oz", 0.99),
      tile("Goya Black Beans 15.5 oz", 1.49, { sponsored: true }),
    ];
    expect(rankTiles("black beans", tiles).map((t) => t.title)).toEqual([
      "Good & Gather Black Beans 15.5 oz",
      "Bush's Black Beans 15 oz",
      "Goya Black Beans 15.5 oz",
      "Heyday Black Bean Enchilada Sauce",
    ]);
  });

  it("requires the main noun, the query's last key word, so thighs don't pass for breast", () => {
    const ranked = rankTiles("boneless skinless chicken breast", [tile("Boneless Skinless Chicken Thighs", 6.99), tile("Boneless Skinless Chicken Breasts 2 lb", 8.99)]);
    expect(ranked.map((t) => t.title)).toEqual(["Boneless Skinless Chicken Breasts 2 lb"]);
  });

  it("keeps the store's order among equally priced matches and puts unpriced ones last", () => {
    const ranked = rankTiles("chicken breast", [tile("Boneless Chicken Breast", undefined), tile("Chicken Breast Tenderloins", 7.99), tile("Organic Chicken Breast", 7.99)]);
    expect(ranked.map((t) => t.title)).toEqual(["Chicken Breast Tenderloins", "Organic Chicken Breast", "Boneless Chicken Breast"]);
  });
});

describe("bestValue", () => {
  it("prefers the store with more items found, then the lower total", () => {
    const summary = bestValue([
      { store: "Sprouts", items: [{ query: "rice", qty: 1, picks: [tile("Rice", 2)] }, { query: "beans", qty: 2, picks: [] }] },
      { store: "Target", items: [{ query: "rice", qty: 1, picks: [tile("Rice", 3)] }, { query: "beans", qty: 2, picks: [tile("Beans", 0.99)] }] },
      { store: "Safeway", items: [{ query: "rice", qty: 1, picks: [tile("Rice", 2.5)] }, { query: "beans", qty: 2, picks: [tile("Beans", 1.5)] }] },
    ]);
    expect(summary).toEqual([
      { store: "Target", found: 2, missing: [], total: 4.98 },
      { store: "Safeway", found: 2, missing: [], total: 5.5 },
      { store: "Sprouts", found: 1, missing: ["beans"], total: 2 },
    ]);
  });
});
