import { describe, expect, it } from "vitest";
import { ActiveCart } from "../../src/shop/cart.js";
import { VersionConflict } from "../../src/workspace/conflict.js";
import { MemoryWorkspaceStore, type WorkspaceStore } from "../../src/workspace/store.js";
import { SUMMARY_LIMIT } from "../../src/workspace/summary.js";

const party = { title: "8th birthday", date: "Nov 14", guests: 12, budget: 300, currency: "USD" };

const open = async (): Promise<{ s: WorkspaceStore; other: WorkspaceStore }> => ({
  s: new MemoryWorkspaceStore(),
  other: new MemoryWorkspaceStore(),
});

describe("MemoryWorkspaceStore", () => {
  it("puts, gets and lists entities per chat with increasing versions", async () => {
    const { s, other } = await open();
    expect(await s.put("event", "main", party)).toBe(1);
    expect(await s.put("event", "main", { ...party, guests: 16 })).toBe(2);
    await s.put("shortlist", "gifts", { title: "Gifts", items: [] });
    await other.put("event", "main", party);
    expect(await s.get("event", "main")).toMatchObject({ version: 2, value: { guests: 16 } });
    expect(await s.get("event", "other")).toBeUndefined();
    expect((await s.list()).map((e) => `${e.kind}:${e.id}`).sort()).toEqual(["event:main", "shortlist:gifts"]);
    expect(await s.list("event")).toHaveLength(1);
    expect(await other.list()).toHaveLength(1);
  });

  it("rejects a write whose expected version is stale and accepts the current one", async () => {
    const { s } = await open();
    await s.put("event", "main", party);
    await s.put("event", "main", { ...party, guests: 14 });
    await expect(s.put("event", "main", party, 1)).rejects.toBeInstanceOf(VersionConflict);
    expect((await s.get("event", "main"))?.value).toMatchObject({ guests: 14 });
    expect(await s.put("event", "main", { ...party, guests: 15 }, 2)).toBe(3);
    expect(await s.put("trip", "new", { destination: "x" }, 0)).toBe(1);
    await expect(s.put("trip", "new2", {}, 3)).rejects.toBeInstanceOf(VersionConflict);
  });

  it("removes entities", async () => {
    const { s } = await open();
    await s.put("event", "main", party);
    expect(await s.remove("event", "main")).toBe(true);
    expect(await s.remove("event", "main")).toBe(false);
    expect(await s.get("event", "main")).toBeUndefined();
  });

  it("summarizes every entity compactly, including the cart's best store", async () => {
    const { s, other } = await open();
    const cart = new ActiveCart();
    cart.start(
      ["target"],
      [
        { query: "pizza", qty: 2 },
        { query: "cake", qty: 1 },
      ],
    );
    const t = (title: string, price: number) => ({ title, price, priceText: `$${price}`, url: `https://t.com/${title}`, sponsored: false });
    cart.addResults([
      {
        store: "Target",
        items: [
          { query: "pizza", qty: 2, picks: [t("pizza", 10)] },
          { query: "cake", qty: 1, picks: [t("cake", 20)] },
        ],
      },
    ]);
    cart.scopeTo(["Target"]);
    await s.put("cart", "main", cart.snapshot());
    await s.put("event", "party", party);
    await s.put("trip", "main", {
      destination: "Tahoe",
      start: "2026-12-01",
      end: "2026-12-04",
      travelers: 1,
      stays: [{ name: "Lodge" }],
      days: [],
    });
    const text = await s.summary();
    expect(text).toContain("event party: 8th birthday, 12 guests, Nov 14, budget $300");
    expect(text).toContain("cart: 2 items at Target (best $40 at Target)");
    expect(text).toContain("trip main: Tahoe, 2026-12-01 to 2026-12-04, 1 traveler, 1 stays shortlisted");
    expect(text.length).toBeLessThan(SUMMARY_LIMIT);
    expect(await other.summary()).toBe("");
  });

  it("caps the summary length", async () => {
    const { s } = await open();
    for (let i = 0; i < 30; i++) await s.put("event", `e${i}`, { ...party, title: `A long party title number ${i}` });
    expect((await s.summary()).length).toBeLessThanOrEqual(SUMMARY_LIMIT);
  });
});
