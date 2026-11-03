import { describe, expect, it } from "vitest";
import { renderData } from "../../src/render/registry.js";

const pick = (title: string, price: number) => ({
  title,
  price,
  priceText: `$${price.toFixed(2)}`,
  url: `https://www.shipt.com/shop/products/${encodeURIComponent(title)}`,
  image: `https://dsom-imager-prod.shipt.com/${encodeURIComponent(title)}.webp`,
  sponsored: false,
});

const data = {
  kind: "shop",
  stores: [
    {
      store: "Safeway (Shipt)",
      home: "https://www.shipt.com/",
      items: [
        { query: "rice", qty: 1, picks: [pick("Signature Rice 2 lb", 3.5)] },
        { query: "black beans", qty: 2, picks: [pick("S&W Black Beans", 1.5)] },
      ],
    },
    {
      store: "Target (Shipt)",
      home: "https://www.shipt.com/",
      items: [
        { query: "rice", qty: 1, picks: [pick("Good & Gather Rice 32oz", 2.39), pick("Instant Rice 14oz", 1.89)] },
        { query: "black beans", qty: 2, picks: [pick("Good & Gather Black Beans", 0.99)] },
      ],
    },
    {
      store: "Petco (Shipt)",
      home: "https://www.shipt.com/",
      items: [
        { query: "rice", qty: 1, picks: [] },
        { query: "black beans", qty: 2, picks: [] },
      ],
    },
  ],
  summary: [
    { store: "Target (Shipt)", found: 2, missing: [], total: 4.37 },
    { store: "Safeway (Shipt)", found: 2, missing: [], total: 6.5 },
  ],
};

describe("shop data renders a cart", () => {
  it("lists stores best value first, each with its items, picks, total, and hand-off link", () => {
    const w = renderData(data) as unknown as {
      kind: string;
      stores: Array<{
        name: string;
        total: number;
        url: string;
        missing: string[];
        items: Array<{ query: string; qty: number; picks: Array<{ title: string }> }>;
      }>;
    };
    expect(w.kind).toBe("cart");
    expect(w.stores.map((s) => s.name)).toEqual(["Target (Shipt)", "Safeway (Shipt)"]);
    expect(w.stores[0]).toMatchObject({ total: 4.37, url: "https://www.shipt.com/", missing: [] });
    expect(w.stores[0].items[0].picks.map((p) => p.title)).toEqual(["Good & Gather Rice 32oz", "Instant Rice 14oz"]);
    expect(w.stores[0].items[1].qty).toBe(2);
  });

  it("renders a cart that grew past one search's 12 items", () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ query: `item ${i}`, qty: 1, picks: [pick(`Item ${i}`, 1)] }));
    const big = {
      kind: "shop",
      stores: [{ store: "Target (Shipt)", home: "https://www.shipt.com/", items }],
      summary: [{ store: "Target (Shipt)", found: 14, missing: [], total: 14 }],
    };
    expect((renderData(big) as unknown as { stores: Array<{ items: unknown[] }> }).stores[0].items).toHaveLength(14);
  });

  it("passes the match label and its reason through to the picks", () => {
    const labeled = {
      kind: "shop",
      stores: [
        {
          store: "Target (Shipt)",
          home: "https://www.shipt.com/",
          items: [
            {
              query: "rice",
              qty: 1,
              picks: [
                { ...pick("Rice", 2), match: "exact", why: "exact, 94%" },
                { ...pick("Quinoa", 3), match: "substitute", why: "substitute, 71%" },
              ],
            },
          ],
        },
      ],
      summary: [{ store: "Target (Shipt)", found: 1, missing: [], total: 2 }],
    };
    const w = renderData(labeled) as unknown as { stores: Array<{ items: Array<{ picks: Array<{ match: string; why: string }> }> }> };
    expect(w.stores[0].items[0].picks.map((p) => [p.match, p.why])).toEqual([
      ["exact", "exact, 94%"],
      ["substitute", "substitute, 71%"],
    ]);
  });

  it("renders nothing when no store had any item", () => {
    expect(renderData({ ...data, summary: [] })).toBeNull();
  });
});
