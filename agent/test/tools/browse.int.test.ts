import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserPool } from "../../src/tools/browserPool.js";
import { browseTool } from "../../src/tools/browse.js";

let server: Server;
let base: string;
const pool = new BrowserPool();

const page = (body: string, title = "Fixture") => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/") {
      res.end(page(`<form action="/search"><input id="q" name="q" type="text"><button id="go" type="submit">Search</button></form>`, "Shop"));
    } else if (url.pathname === "/search") {
      res.end(page(`<h1>Results for ${url.searchParams.get("q")}</h1><p>Sony WH-1000XM5 — in stock — ₹26,990</p><a id="co" href="/checkout">Proceed to checkout</a><a id="cart" href="/cart">View basket</a>`));
    } else if (url.pathname === "/captcha") {
      res.end(page("<h1>Are you a robot?</h1><p>Complete the CAPTCHA</p>"));
    } else if (url.pathname === "/forbidden") {
      res.statusCode = 403;
      res.end(page("Access Denied"));
    } else {
      res.end(page("checkout page"));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await pool.closeAll();
  await new Promise((r) => server.close(r));
});

const text = (r: { content: Array<{ text?: string }> }) => r.content[0].text ?? "";
const run = (threadId: string, actions: unknown[]) =>
  browseTool({ pool, threadId, userContext: null, allowPrivateHosts: true }).execute("c", { actions } as never, undefined, undefined, {} as never);

describe("browse (real Chromium)", () => {
  it("types into search and reads results", async () => {
    const r = await run("t1", [{ op: "goto", url: `${base}/` }, { op: "type", selector: "#q", value: "sony xm5", submit: true }, { op: "read" }]);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Results for sony xm5");
    expect(text(r)).toContain("₹26,990");
    expect(text(r)).toMatch(/^url: .*\/search\?q=sony\+xm5/);
  });

  it("keeps page state across calls on the same thread", async () => {
    const r = await run("t1", [{ op: "read" }]);
    expect(text(r)).toContain("Results for sony xm5");
  });

  it("stops at checkout link with handoff message", async () => {
    await run("t2", [{ op: "goto", url: `${base}/search?q=x` }]);
    const r = await run("t2", [{ op: "click", text: "Proceed to checkout" }]);
    expect(text(r)).toMatch(/^stopped: .+\. Hand this link to the user: .*\/search\?q=x/);
  });

  it("stops when a click navigates onto a blocked url", async () => {
    await run("t3", [{ op: "goto", url: `${base}/search?q=x` }]);
    const r = await run("t3", [{ op: "click", selector: "#cart" }]);
    expect(text(r)).toMatch(/^stopped: /);
    expect(text(r)).toContain("/cart");
  });

  it("detects captcha page as blocked", async () => {
    const r = await run("t4", [{ op: "goto", url: `${base}/captcha` }]);
    expect(text(r)).toBe(`blocked by 127.0.0.1: ${base}/captcha`);
  });

  it("reports 403 as blocked", async () => {
    const r = await run("t4", [{ op: "goto", url: `${base}/forbidden` }]);
    expect(text(r)).toBe(`blocked by 127.0.0.1: ${base}/forbidden`);
  });

  it("caps actions at 10", async () => {
    const r = await run("t5", Array.from({ length: 11 }, () => ({ op: "read" })));
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("too many actions (max 10 per call)");
  });

  it("closing a thread drops its page", async () => {
    await pool.close("t1");
    const r = await run("t1", [{ op: "read" }]);
    expect(text(r)).not.toContain("Results for sony xm5");
  });
});
