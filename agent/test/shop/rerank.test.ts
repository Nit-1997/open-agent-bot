import { describe, expect, it } from "vitest";
import { type Judge, noJudge } from "../../src/judge/index.js";
import type { Tile } from "../../src/shop/extract.js";
import { bestValue, judgeRank, shortlist } from "../../src/shop/rank.js";

const tile = (title: string, price?: number, extra: Partial<Tile> = {}): Tile => ({ title, price, url: `https://s.com/${encodeURIComponent(title)}`, sponsored: false, ...extra });

const levelsJudge = (levels: Record<string, string>, p = 0.9): Judge => ({
  ...noJudge,
  available: true,
  score: (async (items: { id: string; state: { product: string } }[]) => items.map((i) => ({ id: i.id, level: levels[i.state.product] ?? "irrelevant", p, probabilities: {} }))) as never,
});

describe("shortlist", () => {
  it("keeps short lists whole and cuts long ones to the best keyword overlap without dropping partial matches", () => {
    const few = [tile("A"), tile("B")];
    expect(shortlist("black beans", few)).toBe(few);
    const many = [...Array.from({ length: 30 }, (_, i) => tile(`Mystery Item ${i}`)), tile("Bush's Beans Original"), tile("Goya Black Beans")];
    const cut = shortlist("black beans", many, 5).map((t) => t.title);
    expect(cut).toHaveLength(5);
    expect(cut.slice(0, 2)).toEqual(["Goya Black Beans", "Bush's Beans Original"]);
  });
});

describe("judgeRank", () => {
  it("ranks exact before substitute, then unsponsored, then cheaper, and drops complement and irrelevant", async () => {
    const tiles = [
      tile("Sub Cheap", 1),
      tile("Exact Pricey", 5),
      tile("Exact Sponsored", 1, { sponsored: true }),
      tile("Exact Cheap", 2),
      tile("Side Dish", 1),
      tile("Nonsense", 1),
    ];
    const judge = levelsJudge({ "Sub Cheap": "substitute", "Exact Pricey": "exact", "Exact Sponsored": "exact", "Exact Cheap": "exact", "Side Dish": "complement" });
    const ranked = await judgeRank(judge, "thing", tiles);
    expect(ranked?.map((t) => [t.title, t.match])).toEqual([
      ["Exact Cheap", "exact"],
      ["Exact Pricey", "exact"],
      ["Exact Sponsored", "exact"],
      ["Sub Cheap", "substitute"],
    ]);
    expect(ranked?.[0].why).toBe("exact, 90%");
  });

  it("returns null when the judge falls back", async () => {
    expect(await judgeRank({ ...noJudge, available: true }, "x", [tile("A")])).toBeNull();
  });
});

describe("bestValue with substitutes", () => {
  const pick = (title: string, price: number, match?: "exact" | "substitute") => ({ ...tile(title, price), match });

  it("counts only exact matches as found and lists substitute-only items", () => {
    const [store] = bestValue([
      {
        store: "A",
        items: [
          { query: "milk", qty: 1, picks: [pick("Milk", 3, "exact")] },
          { query: "rice", qty: 2, picks: [pick("Quinoa", 4, "substitute")] },
          { query: "eggs", qty: 1, picks: [] },
        ],
      },
    ]);
    expect(store).toEqual({ store: "A", found: 1, missing: ["eggs"], total: 3, substitutes: ["rice"] });
  });

  it("ranks a store with more exact matches above one padded with substitutes", () => {
    const summary = bestValue([
      { store: "Subs", items: [{ query: "a", qty: 1, picks: [pick("A", 1, "substitute")] }, { query: "b", qty: 1, picks: [pick("B", 1, "substitute")] }] },
      { store: "Exact", items: [{ query: "a", qty: 1, picks: [pick("A", 9, "exact")] }, { query: "b", qty: 1, picks: [] }] },
    ]);
    expect(summary.map((s) => s.store)).toEqual(["Exact", "Subs"]);
  });

  it("is unchanged for picks without a match label", () => {
    const [store] = bestValue([{ store: "A", items: [{ query: "milk", qty: 2, picks: [tile("Milk", 3)] }] }]);
    expect(store).toEqual({ store: "A", found: 1, missing: [], total: 6 });
  });
});
