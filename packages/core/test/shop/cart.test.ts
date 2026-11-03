import { describe, expect, it } from "vitest";
import { ActiveCart } from "../../src/shop/cart.js";
import type { Tile } from "../../src/shop/extract.js";

const t = (title: string, price: number): Tile => ({ title, price, url: `https://s.com/${encodeURIComponent(title)}`, sponsored: false });

function cart() {
  const c = new ActiveCart();
  c.start(
    ["shipt"],
    [
      { query: "rice", qty: 1 },
      { query: "black beans", qty: 2 },
    ],
  );
  c.addResults([
    {
      store: "Target (Shipt)",
      items: [
        { query: "rice", qty: 1, picks: [t("G&G Rice", 2.39), t("Instant Rice", 1.89)] },
        { query: "black beans", qty: 2, picks: [t("G&G Beans", 0.99)] },
      ],
    },
    {
      store: "Safeway (Shipt)",
      items: [
        { query: "rice", qty: 1, picks: [t("Signature Rice", 3.5)] },
        { query: "black beans", qty: 2, picks: [] },
      ],
    },
  ]);
  c.scopeTo(["Target (Shipt)", "Safeway (Shipt)"]);
  return c;
}

describe("ActiveCart", () => {
  it("views every item at every store in scope, with missing picks empty", () => {
    const v = cart().view();
    expect(v.map((s) => s.store)).toEqual(["Target (Shipt)", "Safeway (Shipt)"]);
    expect(v[1].items.map((i) => [i.query, i.picks.length])).toEqual([
      ["rice", 1],
      ["black beans", 0],
    ]);
  });

  it("ignores results from stores outside the scope once set", () => {
    const c = cart();
    c.add([{ query: "tortillas", qty: 1 }]);
    c.addResults([{ store: "Petco (Shipt)", items: [{ query: "tortillas", qty: 1, picks: [t("Tortillas", 2)] }] }]);
    expect(c.view().map((s) => s.store)).toEqual(["Target (Shipt)", "Safeway (Shipt)"]);
  });

  it("applies the user's edits from the card: removals, quantities, and chosen products", () => {
    const c = cart();
    c.applyEdits({ removed: ["black beans"], qty: { rice: 3 }, picks: { "Target (Shipt)": { rice: "Instant Rice" } } });
    expect(c.items).toEqual([{ query: "rice", qty: 3 }]);
    expect(c.view()[0].items[0].picks[0].title).toBe("Instant Rice");
  });

  it("treats queries case- and space-insensitively", () => {
    const c = cart();
    expect(c.has(" Black Beans ")).toBe(true);
    c.remove(["RICE"]);
    expect(c.items.map((i) => i.query)).toEqual(["black beans"]);
  });
});
