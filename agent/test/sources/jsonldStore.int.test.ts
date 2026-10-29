import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ActiveCart } from "../../src/shop/cart.js";
import { jsonldStore } from "../../src/sources/retail/jsonldStore.js";
import type { RetailCtx } from "../../src/sources/retail/types.js";
import { BrowserPool } from "../../src/tools/browserPool.js";
import { shopTool } from "../../src/tools/shop.js";

const product = (name: string, price: string, extra: object = {}) => ({
  "@context": "https://schema.org",
  "@graph": [{ "@type": "WebPage", name }, { "@type": "Product", name, image: "/img/p.jpg", brand: { name: "Sony" }, offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: price, offerCount: 2 }, ...extra }],
});
const html = (ld: unknown) => `<!doctype html><html><head><title>P</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>page</body></html>`;

let open: Server;
let walled: Server;
let openBase: string;
let wallBase: string;
const requested: string[] = [];
const pool = new BrowserPool({ allowPrivateHosts: true });

const listen = async (s: Server) => {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
};

beforeAll(async () => {
  open = createServer((req, res) => {
    requested.push(req.url ?? "");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url?.startsWith("/p/xm5")) return res.end(html(product("Sony WH-1000XM5 Wireless Headphones", "298.00")));
    if (req.url?.startsWith("/p/xm4")) return res.end(html(product("Sony WH-1000XM4 Wireless Headphones", "198.00")));
    res.statusCode = 404;
    res.end("nope");
  });
  walled = createServer((_req, res) => {
    res.statusCode = 403;
    res.end("denied");
  });
  openBase = await listen(open);
  wallBase = await listen(walled);
});

afterAll(async () => {
  await pool.closeAll();
  await new Promise((r) => open.close(r));
  await new Promise((r) => walled.close(r));
});

const hostOf = (base: string) => new URL(base).host;
const ctx = (): RetailCtx => ({
  allowPrivateHosts: true,
  webSearch: async () => [
    { title: "XM5", url: `${openBase}/p/xm5` },
    { title: "XM4", url: `${openBase}/p/xm4` },
    { title: "XM5 walled", url: `${wallBase}/p/xm5` },
    { title: "elsewhere", url: "https://other.example/p/xm5" },
  ],
});

describe("JSON-LD store for unknown domains", () => {
  it("reads prices and links from product pages on the store's own site only", async () => {
    const r = await jsonldStore(hostOf(openBase), `${openBase}/`).search({ query: "Sony WH-1000XM5" }, ctx());
    expect(r.blocked).toBeUndefined();
    expect(r.tiles.map((t) => [t.title, t.price, t.url])).toEqual([
      ["Sony WH-1000XM5 Wireless Headphones", 298, `${openBase}/p/xm5`],
      ["Sony WH-1000XM4 Wireless Headphones", 198, `${openBase}/p/xm4`],
    ]);
    expect(r.tiles[0].image).toBe(`${openBase}/img/p.jpg`);
  });

  it("reports a clear block with a link when the site denies access", async () => {
    const r = await jsonldStore(hostOf(wallBase), `${wallBase}/`).search({ query: "Sony WH-1000XM5" }, ctx());
    expect(r.tiles).toEqual([]);
    expect(r.blocked).toBe(`${wallBase}/p/xm5`);
  });

  it("falls back to guessed site-search addresses when search gives no pages", async () => {
    requested.length = 0;
    const r = await jsonldStore(hostOf(openBase), `${openBase}/`).search({ query: "xm5" }, { allowPrivateHosts: true });
    expect(r.tiles).toEqual([]);
    expect(requested.sort()).toEqual(["/s?k=xm5", "/search?q=xm5", "/search?query=xm5"]);
  });

  it("answers one shop call with a price for one store and a block for the other", async () => {
    const stores: Record<string, ReturnType<typeof jsonldStore>> = {
      [hostOf(openBase)]: jsonldStore(hostOf(openBase), `${openBase}/`),
      [hostOf(wallBase)]: jsonldStore(hostOf(wallBase), `${wallBase}/`),
    };
    const tool = shopTool({
      pool,
      threadId: "jsonld-t",
      userContext: null,
      allowPrivateHosts: true,
      sourcesV2: true,
      webSearch: ctx().webSearch,
      storeFor: (s) => stores[s],
      cart: new ActiveCart(),
    });
    const r = (await tool.execute(...(["c", { stores: Object.keys(stores), items: [{ query: "Sony WH-1000XM5 Wireless Headphones" }] }, undefined, undefined, {}] as never[]))) as { content: Array<{ text: string }> };
    const text = r.content[0].text;
    expect(text).toContain("Sony WH-1000XM5 Wireless Headphones — $298.00");
    expect(text).toContain(`${wallBase}/p/xm5`);
    expect(text).toMatch(/blocked by a bot check/);
  }, 60000);
});
