import { describe, expect, it } from "vitest";
import type { MessagePart } from "../../../shared/chats.js";
import type { Cart } from "../../../shared/widgets.js";
import type { Tile } from "../../src/shop/extract.js";
import type { Store } from "../../src/shop/stores.js";
import { type Job, type JobResult, shopTool } from "../../src/tools/shop.js";
import { planTool } from "../../src/tools/plan.js";
import { workspaceCart, workspaceNote } from "../../src/workspace/cart.js";
import { earlierCards, earlierNote } from "../../src/workspace/earlier.js";
import { MemoryWorkspaceStore } from "../../src/workspace/store.js";

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

async function setup() {
  const store = new MemoryWorkspaceStore();
  const searches: string[][] = [];
  const search = async (jobs: Job[]): Promise<JobResult[]> => {
    searches.push(jobs.map((j) => j.item.query));
    return jobs.map((j) => ({ store: j.store, item: j.item, tiles: [tile(j.item.query, 5)] }));
  };
  const cart = await workspaceCart(store);
  const shop = shopTool({
    pool: {} as never,
    threadId: "t",
    userContext: null,
    storeFor: (n) => (n === "target" ? target : undefined),
    cart,
    search,
  });
  const plan = planTool({ store });
  const callShop = (p: object) => shop.execute("c", p as never, undefined, undefined, {} as never);
  const callPlan = (p: object) => plan.execute("c", p as never, undefined, undefined, {} as never);
  return { store, cart, searches, callShop, callPlan };
}

const part = (widget: Cart): MessagePart => ({ type: "tool", id: "c-widget", name: "show_widget", args: JSON.stringify({ widget }) });

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("party follow-up: make it 16 kids", () => {
  it("patches guests and changes only quantities, with no new catalog search", async () => {
    const { store, searches, callShop, callPlan } = await setup();
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
    await settle();
    const picksBefore = (await store.get("cart", "main"))?.value;

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
    await settle();
    const event = await store.get("event", "main");
    expect(event).toMatchObject({ version: 2, value: { guests: 16, title: "8th birthday", budget: 300 } });
    const cart = (await store.get("cart", "main"))?.value as { items: { query: string; qty: number }[]; picks: unknown };
    expect(cart.items).toEqual([
      { query: "pizza", qty: 4 },
      { query: "plates", qty: 16 },
      { query: "cake", qty: 1 },
    ]);
    expect(cart.picks).toEqual((picksBefore as { picks: unknown }).picks);
    expect(r.details.data).toMatchObject({ kind: "shop" });
  });

  it("gives the next turn a summary that reflects the patched event and the cart", async () => {
    const { store, callShop, callPlan } = await setup();
    await callPlan({ action: "set", kind: "event", value: { title: "8th birthday", guests: 12 } });
    await callShop({ stores: ["target"], items: [{ query: "pizza", qty: 3 }] });
    await callPlan({ action: "patch", kind: "event", ops: [{ op: "replace", path: "/guests", value: 16 }] });
    await settle();
    const note = await workspaceNote(store);
    expect(note).toMatch(/^<workspace>\n/);
    expect(note).toContain("16 guests");
    expect(note).toContain("cart: 1 item at Target");
    expect(await workspaceNote(new MemoryWorkspaceStore())).toBeUndefined();
  });

  it("a new session starts with an empty cart and an earlier-cards note", async () => {
    const { store, callShop } = await setup();
    await callShop({ stores: ["target"], items: [{ query: "pizza", qty: 3 }] });
    await settle();
    const card: Cart = {
      kind: "cart",
      stores: [{ name: "Target", total: 15, url: "https://www.target.com/", missing: [], items: [{ query: "pizza", qty: 3, picks: [] }] }],
    };
    const fresh = new MemoryWorkspaceStore();
    const cart = await workspaceCart(fresh);
    expect(cart.empty).toBe(true);
    expect(await workspaceNote(fresh)).toBeUndefined();
    expect((await store.get("cart", "main"))?.value).toBeDefined();
    const earlier = earlierCards([
      { role: "assistant", content: "", status: "complete", createdAt: "2026-11-01T15:10:00Z", parts: [part(card)] },
    ]);
    const note = earlierNote(earlier, { cartLive: !cart.empty, plansLive: false });
    expect(note).toContain("cart (shown 2026-11-01): pizza ×3 at Target; best $15.00 at Target");
  });

  it("applies UI edits to the session cart", async () => {
    const { store, cart, callShop } = await setup();
    await callShop({
      stores: ["target"],
      items: [
        { query: "pizza", qty: 3 },
        { query: "cake", qty: 1 },
      ],
    });
    cart.applyEdits({ removed: ["cake"], qty: { pizza: 5 } });
    await settle();
    expect(cart.items).toEqual([{ query: "pizza", qty: 5 }]);
    expect(((await store.get("cart", "main"))!.value as { items: unknown }).items).toEqual([{ query: "pizza", qty: 5 }]);
  });
});
