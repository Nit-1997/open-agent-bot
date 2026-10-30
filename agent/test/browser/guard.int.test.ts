import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockInternalRequests } from "../../src/browser/guard.js";

let server: Server;
let base: string;
let browser: Browser;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.setHeader("content-type", "text/html");
    res.end("<title>inside</title>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
  await new Promise((r) => server.close(r));
});

describe("blockInternalRequests", () => {
  it("aborts requests to private addresses, including from page scripts", async () => {
    const context = await browser.newContext();
    await blockInternalRequests(context);
    const page = await context.newPage();
    await expect(page.goto(`${base}/direct`)).rejects.toThrow();
    const other = await context.newPage();
    await other.setContent(`<img src="${base}/pixel">`);
    await other.evaluate((u) => fetch(u).catch(() => null), `${base}/xhr`);
    await context.close();
    expect(hits).toEqual([]);
  });

  it("aborts public names that resolve to a private address", async () => {
    const context = await browser.newContext();
    await blockInternalRequests(context, { lookup: async () => ["127.0.0.1"] });
    const page = await context.newPage();
    await expect(page.goto("http://rebind.example.com/")).rejects.toThrow();
    await context.close();
  });

  it("lets everything through when private hosts are allowed", async () => {
    const context = await browser.newContext();
    await blockInternalRequests(context, { allowPrivateHosts: true });
    const page = await context.newPage();
    await page.goto(`${base}/allowed`);
    expect(await page.title()).toBe("inside");
    await context.close();
  });
});
