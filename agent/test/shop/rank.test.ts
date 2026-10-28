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

  it("ranks a different form of the product (chips, mix, flavored) after the product itself", () => {
    const pico = rankTiles("pico de gallo", [tile("Pico de Gallo Flavored Tortilla Chips", 2.5), tile("Grillo's Pickle de Gallo", 6.69), tile("Fresh Pico de Gallo 16 oz", 8.59)]);
    expect(pico[0].title).toBe("Fresh Pico de Gallo 16 oz");
    const rice = rankTiles("long grain white rice", [tile("Rice-A-Roni Long Grain & Wild Rice Mix", 1.5), tile("Sunny Select Long Grain White Rice 2 lb", 2.09)]);
    expect(rice[0].title).toBe("Sunny Select Long Grain White Rice 2 lb");
    expect(rankTiles("tortilla chips", [tile("Tortilla Chips", 3), tile("Flour Tortillas", 2)])[0].title).toBe("Tortilla Chips");
  });

  it("drops a different product form that only partly matches, even when it's the only result", () => {
    expect(rankTiles("pico de gallo", [tile("Grillo's Pickles Mild Pickle de Gallo 16 oz", 6.69)])).toEqual([]);
    expect(rankTiles("pico de gallo", [tile("Pico de Gallo Flavored Tortilla Chips", 2.5)])).toHaveLength(1);
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
