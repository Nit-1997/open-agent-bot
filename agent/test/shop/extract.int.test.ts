import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Browser, chromium, type Page } from "playwright";
import { extractTiles } from "../../src/shop/extract.js";

let browser: Browser;
let page: Page;

const img = (src: string, alt = "", attrs = "") => `<img src="${src}" alt="${alt}" width="160" height="160" ${attrs}>`;
const PX = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

const grid = `
  <h2 class="store">Target</h2>
  <ul>
    <li class="card"><a href="/p/beans">${img("https://cdn.shop.com/beans.jpg", "Good & Gather Black Beans 15.5oz")}</a><span>15.5 oz</span><span>$0.99</span><span>4.5 out of 5 stars</span></li>
    <li class="card"><span>Sponsored</span><a href="https://shop.com/p/ad">${img("https://cdn.shop.com/ad.jpg", "Heyday Black Bean Enchilada Sauce")}</a><span>$5.99</span></li>
    <li class="card"><a href="/p/goya">${img(PX, "Goya Black Beans 15.5 oz", 'data-src="https://cdn.shop.com/goya.jpg"')}</a><span>$1.49</span></li>
  </ul>
  <h2 class="store">Safeway</h2>
  <ul><li class="card"><a href="/p/bush">${img("/img/bush.jpg", "Bush's Black Beans 15 oz")}</a><span>$1.69</span></li></ul>
  <div><a href="/promo">${img("https://cdn.shop.com/banner.jpg", "Fall savings event")}</a><p>Save big this week</p></div>
`;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route("https://shop.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${grid}</body></html>` }));
  await page.goto("https://shop.test/search?q=black+beans");
});

afterAll(async () => {
  await browser?.close();
});

describe("extractTiles", () => {
  it("names groups from a section link's address when the store marks sections that way", async () => {
    const p2 = await browser.newPage();
    const body = `<a href="/shop/smart-final/search?q=x">View all</a><ul><li><a href="/p/1">${img("https://cdn.s.com/1.jpg", "Signature Black Beans 15 oz")}</a><span>$1.25</span></li></ul>`;
    await p2.route("https://shop2.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${body}</body></html>` }));
    await p2.goto("https://shop2.test/");
    const tiles = await extractTiles(p2, { groupSelector: 'a[href*="/shop/"]', groupFromHref: "/shop/([^/]+)/" });
    expect(tiles[0].group).toBe("Smart Final");
    await p2.close();
  });

  it("reads each product card with an absolute link, price, and picture, skipping banners", async () => {
    const tiles = await extractTiles(page, { groupSelector: "h2.store" });
    expect(tiles.map((t) => t.title)).toEqual([
      "Good & Gather Black Beans 15.5oz",
      "Heyday Black Bean Enchilada Sauce",
      "Goya Black Beans 15.5 oz",
      "Bush's Black Beans 15 oz",
    ]);
    const [beans, ad, goya, bush] = tiles;
    expect(beans).toMatchObject({ url: "https://shop.test/p/beans", image: "https://cdn.shop.com/beans.jpg", price: 0.99, priceText: "$0.99", rating: 4.5, size: "15.5 oz", sponsored: false, group: "Target" });
    expect(ad.sponsored).toBe(true);
    expect(goya.image).toBe("https://cdn.shop.com/goya.jpg");
    expect(bush).toMatchObject({ image: "https://shop.test/img/bush.jpg", group: "Safeway" });
  });
});
