import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Store } from "../../src/shop/stores.js";
import { ActiveCart } from "../../src/shop/cart.js";
import { BrowserPool } from "../../src/tools/browserPool.js";
import { shopTool } from "../../src/tools/shop.js";

let server: Server;
const hits: string[] = [];
let base: string;
const pool = new BrowserPool({ allowPrivateHosts: true });

const card = (title: string, price: string, img: string, href: string, extra = "") =>
  `<li><a href="${href}"><img src="${img}" alt="${title}" width="150" height="150"></a><span>${price}</span>${extra}</li>`;

const CATALOG: Record<string, string> = {
  "black beans": card("Goya Black Beans 15.5 oz", "$1.49", "/img/goya.jpg", "/p/goya") + card("Store Black Beans 15 oz", "$0.89", "/img/store.jpg", "/p/store") + card("Black Bean Chips", "$3.99", "/img/chips.jpg", "/p/chips", "<em>Sponsored</em>"),
  rice: card("Long Grain White Rice 2 lb", "$2.49", "/img/rice.jpg", "/p/rice"),
};

const html = (body: string) => `<!doctype html><html><head><title>Fixture</title></head><body>${body}</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    if (url.pathname.endsWith("/search")) hits.push(`${url.pathname}?${q}`);
    if (url.pathname === "/m/search") {
      const section = (slug: string, price: number) => `<a href="/shop/${slug}/search?q=x">View all</a><ul>${card(`${slug} ${q} 1 lb`, `$${price.toFixed(2)}`, `/img/${slug}.jpg`, `/p/${slug}-${encodeURIComponent(q)}`)}</ul>`;
      return res.end(html(section("alpha", 1) + section("beta", 2) + section("gamma", 3) + section("delta", 4)));
    }
    if (url.pathname === "/a/search" && q === "tortillas") return res.end(html(`<ul>${card("Flour Tortillas 10 ct", "$2.99", "/img/t.jpg", "/p/t")}</ul>`));
    if (url.pathname === "/a/search") return res.end(html(`<ul>${CATALOG[q] ?? ""}</ul>`));
    if (url.pathname === "/b/search") return res.end(html(`<ul>${q === "rice" ? card("Jasmine Rice 2 lb", "$3.10", "/img/j.jpg", "/p/j") : ""}${q === "black beans" ? card("Organic Black Beans 15 oz", "$1.10", "/img/o.jpg", "/p/o") : ""}</ul>`));
    if (url.pathname === "/c/") return res.end(html(`<form action="/c/results"><input name="search" placeholder="Search"><button>Go</button></form>`));
    if (url.pathname === "/c/results") return res.end(html(`<ul>${CATALOG[(url.searchParams.get("search") ?? "").toLowerCase()] ?? ""}</ul>`));
    if (url.pathname === "/wall/search") return res.end(html("<h1>Robot or human?</h1><p>Activate and hold the button</p>"));
    if (url.pathname === "/sorry/search") return res.end(`<!doctype html><html><head><title>Sorry! Something went wrong!</title></head><body><img src="/dog.jpg"></body></html>`);
    res.statusCode = 404;
    res.end(html("nope"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await pool.closeAll();
  await new Promise((r) => server.close(r));
});

const stores = (): Record<string, Store> => ({
  storea: { id: "storea", label: "Store A", home: `${base}/a/`, searchUrl: (q) => `${base}/a/search?q=${encodeURIComponent(q)}`, scrolls: 0 },
  storeb: { id: "storeb", label: "Store B", home: `${base}/b/`, searchUrl: (q) => `${base}/b/search?q=${encodeURIComponent(q)}`, scrolls: 0 },
  storec: { id: "storec", label: "Store C", home: `${base}/c/`, scrolls: 0 },
  sorry: { id: "sorry", label: "Sorry Store", home: `${base}/sorry/`, searchUrl: (q) => `${base}/sorry/search?q=${encodeURIComponent(q)}`, scrolls: 0 },
  mkt: { id: "mkt", label: "Mkt", home: `${base}/m/`, searchUrl: (q) => `${base}/m/search?q=${encodeURIComponent(q)}`, marketplace: true, groupSelector: 'a[href*="/shop/"]', groupFromHref: "/shop/([^/]+)/search", scrolls: 0 },
  wall: { id: "wall", label: "Wall Mart", home: `${base}/wall/`, searchUrl: (q) => `${base}/wall/search?q=${encodeURIComponent(q)}`, scrolls: 0 },
});

const run = (params: object, cart = new ActiveCart()) =>
  shopTool({ pool, threadId: "shop-t", userContext: null, allowPrivateHosts: true, storeFor: (s) => stores()[s.toLowerCase()], cart }).execute(
    ...(["c", params, undefined, undefined, {}] as never[]),
  ) as Promise<{ isError?: boolean; content: Array<{ text: string }>; details: { data?: { summary: Array<{ store: string; found: number; total: number; missing: string[] }> } } }>;

describe("shop (real Chromium)", () => {
  it("searches each store for each item, picks real catalog matches, and ranks stores by value", async () => {
    const r = await run({ stores: ["storea", "storeb"], items: [{ query: "black beans", qty: 2 }, { query: "rice" }, { query: "cilantro" }] });
    const t = r.content[0].text;
    expect(r.details.data?.summary).toEqual([
      { store: "Store A", found: 2, missing: ["cilantro"], total: 4.27 },
      { store: "Store B", found: 2, missing: ["cilantro"], total: 5.3 },
    ]);
    expect(t).toMatch(/^Best value: Store A — 2 of 3 items, \$4\.27 \(missing: cilantro\)/m);
    expect(t).toContain(`1. Store Black Beans 15 oz — $0.89 · 15 oz\n     link: ${base}/p/store\n     image: ${base}/img/store.jpg`);
    expect(t.indexOf("Goya Black Beans")).toBeLessThan(t.indexOf("Black Bean Chips"));
    expect(t).toContain("- cilantro: not found");
  }, 60000);

  it("uses a store's own search box when it has no search address", async () => {
    const r = await run({ stores: ["storec"], items: [{ query: "rice" }] });
    expect(r.content[0].text).toContain("Long Grain White Rice 2 lb — $2.49");
  }, 60000);

  it("reports a bot check as blocked with the search link, without products", async () => {
    const r = await run({ stores: ["wall"], items: [{ query: "rice" }] });
    expect(r.content[0].text).toContain(`Wall Mart: blocked by a bot check. Link for the user: ${base}/wall/search?q=rice`);
  }, 60000);

  it("adds new items to the existing cart, keeping earlier items and stores and searching only what's new", async () => {
    const cart = new ActiveCart();
    await run({ stores: ["storea", "storeb"], items: [{ query: "black beans", qty: 2 }, { query: "rice" }] }, cart);
    hits.length = 0;
    const r = await run({ items: [{ query: "tortillas" }] }, cart);
    expect(hits).toEqual(["/a/search?tortillas", "/b/search?tortillas"]);
    const stores = (r.details.data as unknown as { stores: Array<{ store: string; items: Array<{ query: string }> }> }).stores;
    expect(stores.map((s) => s.store)).toEqual(["Store A", "Store B"]);
    expect(stores[0].items.map((i) => i.query)).toEqual(["black beans", "rice", "tortillas"]);
    expect(r.content[0].text).toMatch(/^Cart: 3 items at Store A, Store B\. Added: tortillas\./);
    expect(r.content[0].text).toContain("Best value: Store A — 3 of 3 items");
  }, 60000);

  it("keeps follow-ups to the stores the first cart compared inside a marketplace", async () => {
    const cart = new ActiveCart();
    const first = await run({ stores: ["mkt"], items: [{ query: "rice" }] }, cart);
    expect(first.details.data?.summary.map((s) => s.store)).toEqual(["Alpha (Mkt)", "Beta (Mkt)", "Gamma (Mkt)"]);
    const next = await run({ stores: ["mkt"], items: [{ query: "salsa" }] }, cart);
    expect(next.details.data?.summary.map((s) => [s.store, s.found])).toEqual([["Alpha (Mkt)", 2], ["Beta (Mkt)", 2], ["Gamma (Mkt)", 2]]);
  }, 60000);

  it("removes items and re-checks the whole list when the user switches stores", async () => {
    const cart = new ActiveCart();
    await run({ stores: ["storea"], items: [{ query: "black beans" }, { query: "rice" }] }, cart);
    const removed = await run({ remove: ["rice"] }, cart);
    expect(removed.details.data?.summary[0]).toMatchObject({ store: "Store A", found: 1 });
    hits.length = 0;
    const moved = await run({ stores: ["storeb"], items: [] }, cart);
    expect(hits).toEqual(["/b/search?black beans"]);
    expect(moved.details.data?.summary.map((s) => s.store)).toEqual(["Store B"]);
  }, 60000);

  it("starts over when asked for a new cart", async () => {
    const cart = new ActiveCart();
    await run({ stores: ["storea"], items: [{ query: "black beans" }] }, cart);
    const r = await run({ stores: ["storea"], items: [{ query: "rice" }], new_cart: true }, cart);
    expect((r.details.data as unknown as { stores: Array<{ items: unknown[] }> }).stores[0].items).toHaveLength(1);
  }, 60000);

  it("treats a store's error page as blocked too", async () => {
    const r = await run({ stores: ["sorry"], items: [{ query: "rice" }] });
    expect(r.content[0].text).toContain("Sorry Store: blocked by a bot check.");
  }, 60000);
});
