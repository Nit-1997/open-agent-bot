import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { VersionConflict } from "../../src/workspace/conflict.js";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { SUMMARY_LIMIT } from "../../src/workspace/summary.js";
import { ActiveCart } from "../../src/shop/cart.js";

const stores: WorkspaceStore[] = [];
function open(now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "ws-"));
  const s = new WorkspaceStore(join(dir, "nested", "workspace.sqlite"), now);
  stores.push(s);
  return { s, dir };
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

const party = { title: "8th birthday", date: "Nov 14", guests: 12, budget: 300, currency: "USD" };

describe("WorkspaceStore", () => {
  it("creates the file with mode 0600 inside a missing directory", () => {
    const { dir } = open();
    expect(statSync(join(dir, "nested", "workspace.sqlite")).mode & 0o777).toBe(0o600);
  });

  it("puts, gets and lists entities per thread with increasing versions", () => {
    const { s } = open();
    expect(s.put("t1", "event", "main", party)).toBe(1);
    expect(s.put("t1", "event", "main", { ...party, guests: 16 })).toBe(2);
    s.put("t1", "shortlist", "gifts", { title: "Gifts", items: [] });
    s.put("t2", "event", "main", party);
    expect(s.get("t1", "event", "main")).toMatchObject({ version: 2, value: { guests: 16 } });
    expect(s.get("t1", "event", "other")).toBeUndefined();
    expect(s.list("t1").map((e) => `${e.kind}:${e.id}`).sort()).toEqual(["event:main", "shortlist:gifts"]);
    expect(s.list("t1", "event")).toHaveLength(1);
    expect(s.list("nobody")).toEqual([]);
  });

  it("rejects a write whose expected version is stale and accepts the current one", () => {
    const { s } = open();
    s.put("t", "event", "main", party);
    s.put("t", "event", "main", { ...party, guests: 14 });
    expect(() => s.put("t", "event", "main", party, 1)).toThrow(VersionConflict);
    expect(s.get("t", "event", "main")?.value).toMatchObject({ guests: 14 });
    expect(s.put("t", "event", "main", { ...party, guests: 15 }, 2)).toBe(3);
    expect(s.put("t", "trip", "new", { destination: "x" }, 0)).toBe(1);
    expect(() => s.put("t", "trip", "new2", {}, 3)).toThrow(VersionConflict);
  });

  it("removes entities", () => {
    const { s } = open();
    s.put("t", "event", "main", party);
    expect(s.remove("t", "event", "main")).toBe(true);
    expect(s.remove("t", "event", "main")).toBe(false);
    expect(s.get("t", "event", "main")).toBeUndefined();
  });

  it("survives a reopen", () => {
    const { s, dir } = open();
    s.put("t", "event", "main", party);
    const again = new WorkspaceStore(join(dir, "nested", "workspace.sqlite"));
    stores.push(again);
    expect(again.get("t", "event", "main")?.version).toBe(1);
  });

  it("summarizes every entity compactly, including the cart's best store", () => {
    const { s } = open();
    const cart = new ActiveCart();
    cart.start(["target"], [{ query: "pizza", qty: 2 }, { query: "cake", qty: 1 }]);
    const t = (title: string, price: number) => ({ title, price, priceText: `$${price}`, url: `https://t.com/${title}`, sponsored: false });
    cart.addResults([{ store: "Target", items: [{ query: "pizza", qty: 2, picks: [t("pizza", 10)] }, { query: "cake", qty: 1, picks: [t("cake", 20)] }] }]);
    cart.scopeTo(["Target"]);
    s.put("t", "cart", "main", cart.snapshot());
    s.put("t", "event", "party", party);
    s.put("t", "trip", "main", { destination: "Tahoe", start: "2026-12-01", end: "2026-12-04", travelers: 1, stays: [{ name: "Lodge" }], days: [] });
    const text = s.summary("t");
    expect(text).toContain("event party: 8th birthday, 12 guests, Nov 14, budget $300");
    expect(text).toContain("cart: 2 items at Target (best $40 at Target)");
    expect(text).toContain("trip main: Tahoe, 2026-12-01 to 2026-12-04, 1 traveler, 1 stays shortlisted");
    expect(text.length).toBeLessThan(SUMMARY_LIMIT);
    expect(s.summary("empty")).toBe("");
  });

  it("caps the summary length", () => {
    const { s } = open();
    for (let i = 0; i < 30; i++) s.put("t", "event", `e${i}`, { ...party, title: `A long party title number ${i}` });
    expect(s.summary("t").length).toBeLessThanOrEqual(SUMMARY_LIMIT);
  });
});
