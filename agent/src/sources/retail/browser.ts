import type { Page } from "playwright";
import { extractTiles } from "../../shop/extract.js";
import { BOT_WALL, isBlockedUrl } from "../../tools/browsePolicy.js";
import { publicHttpUrlError } from "../../tools/net.js";
import type { RetailCtx, RetailQuery, RetailResult, RetailSource, Store } from "./types.js";

async function searchBox(page: Page, store: Store, query: string): Promise<void> {
  await page.goto(store.home, { waitUntil: "domcontentloaded", timeout: 20000 });
  const box = page
    .locator(
      'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], input[name="q"]',
    )
    .first();
  await box.fill(query, { timeout: 8000 });
  await box.press("Enter");
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
}

async function settle(page: Page, scrolls: number): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  for (let i = 0; i < scrolls; i++) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(600);
  }
}

export async function browserSearch(store: Store, q: RetailQuery, ctx: RetailCtx): Promise<RetailResult> {
  const page = ctx.page;
  if (!page) return { tiles: [], error: "no browser tab available" };
  const target = store.searchUrl?.(q.query) ?? store.home;
  const urlError = publicHttpUrlError(target, { allowPrivateHosts: ctx.allowPrivateHosts });
  if (urlError) return { tiles: [], error: urlError };
  try {
    if (store.searchUrl) await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
    else await searchBox(page, store, q.query);
    if (isBlockedUrl(page.url())) return { tiles: [], blocked: page.url() };
    await settle(page, store.scrolls ?? 3);
    const head = await page.evaluate(() => `${document.title}\n${document.body?.innerText.slice(0, 1500) ?? ""}`);
    if (BOT_WALL.test(head)) return { tiles: [], blocked: target };
    return { tiles: await extractTiles(page, { groupSelector: store.groupSelector, groupFromHref: store.groupFromHref }) };
  } catch (err) {
    return { tiles: [], error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

type Def = Omit<RetailSource, "vertical" | "capabilities" | "search" | "domains"> & { domains?: string[]; capabilities?: string[] };

export function browserStore(def: Def): RetailSource {
  const store: RetailSource = {
    vertical: "retail",
    capabilities: ["search", "price"],
    domains: [`${def.id}.com`],
    ...def,
    search: (q, ctx) => browserSearch(store, q, ctx),
  };
  return store;
}
