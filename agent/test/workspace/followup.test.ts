import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Tile } from "../../src/shop/extract.js";
import type { Store } from "../../src/shop/stores.js";
import { type Job, type JobResult, shopTool } from "../../src/tools/shop.js";
import { planTool } from "../../src/tools/plan.js";
import { workspaceCart, workspaceNote } from "../../src/workspace/cart.js";
import { WorkspaceStore } from "../../src/workspace/store.js";

const target: Store = {
  id: "target",
  label: "Target",
  home: "https://www.target.com/",
  searchUrl: (q) => `https://www.target.com/s?searchTerm=${q}`,
};
const tile = (title: string, price: number): Tile => ({
  title,
  price,
  priceText: `$${price}`,
  url: `https://www.target.com/p/${title}`,
  sponsored: false,
});

const stores: WorkspaceStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

function setup() {
  const store = new WorkspaceStore(join(mkdtempSync(join(tmpdir(), "follow-")), "w.sqlite"));
  stores.push(store);
  const searches: string[][] = [];
  const search = async (jobs: Job[]): Promise<JobResult[]> => {
    searches.push(jobs.map((j) => j.item.query));
    return jobs.map((j) => ({ store: j.store, item: j.item, tiles: [tile(j.item.query, 5)] }));
  };
  const cart = workspaceCart(store, "t");
  const shop = shopTool({
    pool: {} as never,
    threadId: "t",
    userContext: null,
    storeFor: (n) => (n === "target" ? target : undefined),
    cart,
    search,
  });
  const plan = planTool({ store, threadId: "t" });
  const callShop = (p: object) => shop.execute("c", p as never, undefined, undefined, {} as never);
  const callPlan = (p: object) => plan.execute("c", p as never, undefined, undefined, {} as never);
  return { store, searches, callShop, callPlan };
}

describe("party follow-up: make it 16 kids", () => {
  it("patches guests and changes only quantities, with no new catalog search", async () => {
    const { store, searches, callShop, callPlan } = setup();
    await callPlan({ action: "set", kind: "event", value: { title: "8th birthday", date: "Nov 14", guests: 12, budget: 300 } });
    await callShop({
      stores: ["target"],
      items: [
        { query: "pizza", qty: 3 },
        { query: "plates", qty: 12 },
        { query: "cake", qty: 1 },
      ],
    });
    expect(searches).toEqual([["pizza", "plates", "cake"]]);
    const picksBefore = store.get("t", "cart", "main")?.value;

    const patched = await callPlan({ action: "patch", kind: "event", ops: [{ op: "replace", path: "/guests", value: 16 }] });
    expect(patched.isError).toBeUndefined();
    const r = await callShop({
      items: [
        { query: "pizza", qty: 4 },
        { query: "plates", qty: 16 },
      ],
    });

    expect(r.isError).toBeUndefined();
    expect(searches).toHaveLength(1);
    const event = store.get("t", "event", "main");
    expect(event).toMatchObject({ version: 2, value: { guests: 16, title: "8th birthday", budget: 300 } });
    const cart = store.get("t", "cart", "main")?.value as { items: { query: string; qty: number }[]; picks: unknown };
    expect(cart.items).toEqual([
      { query: "pizza", qty: 4 },
      { query: "plates", qty: 16 },
      { query: "cake", qty: 1 },
    ]);
    expect(cart.picks).toEqual((picksBefore as { picks: unknown }).picks);
    expect(r.details.data).toMatchObject({ kind: "shop" });
  });

  it("gives the next turn a summary that reflects the patched event and the cart", async () => {
    const { store, callShop, callPlan } = setup();
    await callPlan({ action: "set", kind: "event", value: { title: "8th birthday", guests: 12 } });
    await callShop({ stores: ["target"], items: [{ query: "pizza", qty: 3 }] });
    await callPlan({ action: "patch", kind: "event", ops: [{ op: "replace", path: "/guests", value: 16 }] });
    const note = workspaceNote(store, "t");
    expect(note).toMatch(/^<workspace>\n/);
    expect(note).toContain("16 guests");
    expect(note).toContain("cart: 1 item at Target");
    expect(workspaceNote(store, "other")).toBeUndefined();
  });

  it("reloads the cart from the workspace into a new session", async () => {
    const { store, callShop } = setup();
    await callShop({ stores: ["target"], items: [{ query: "pizza", qty: 3 }] });
    const revived = workspaceCart(store, "t");
    expect(revived.items).toEqual([{ query: "pizza", qty: 3 }]);
    expect(revived.stores).toEqual(["target"]);
    expect(revived.view()[0].items[0].picks[0].title).toBe("pizza");
  });

  it("persists UI edits to the cart", async () => {
    const { store, callShop } = setup();
    await callShop({
      stores: ["target"],
      items: [
        { query: "pizza", qty: 3 },
        { query: "cake", qty: 1 },
      ],
    });
    workspaceCart(store, "t").applyEdits({ removed: ["cake"], qty: { pizza: 5 } });
    expect((store.get("t", "cart", "main")!.value as { items: unknown }).items).toEqual([{ query: "pizza", qty: 5 }]);
  });
});
