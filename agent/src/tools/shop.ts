import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright";
import { Type } from "typebox";
import type { UserContext } from "../prompt/systemPrompt.js";
import { extractTiles, type Tile } from "../shop/extract.js";
import { bestValue, rankTiles, type StoreResult } from "../shop/rank.js";
import { type Store, storeFor as defaultStoreFor } from "../shop/stores.js";
import { type FrameBus, watch } from "../browser/frames.js";
import type { BrowserPool } from "./browserPool.js";
import { isBlockedUrl } from "./browsePolicy.js";
import { publicHttpUrlError } from "./net.js";
import { fail, ok, type ToolResult } from "./result.js";

const MAX_STORES = 3;
const MAX_ITEMS = 12;
const TABS = 4;
const PICKS = 3;
const BOT_WALL = /(robot or human|are you a robot|captcha|access denied|unusual traffic|verify you are human|press and hold|sorry! something went wrong)/i;

type Item = { query: string; qty: number };
type Job = { store: Store; item: Item };
type JobResult = { store: Store; item: Item; tiles: Tile[]; blocked?: string; error?: string };

type Deps = {
  pool: BrowserPool;
  threadId: string;
  userContext: UserContext | null;
  allowPrivateHosts?: boolean;
  storeFor?: (name: string) => Store | undefined;
  frames?: FrameBus;
};

function list<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return v.split(",").map((s) => s.trim()).filter(Boolean) as T[];
    }
  }
  return [];
}

function items(v: unknown): Item[] {
  return list<unknown>(v)
    .map((x) => (typeof x === "string" ? { query: x, qty: 1 } : { query: String((x as Item).query ?? ""), qty: Math.max(1, Math.round(Number((x as Item).qty) || 1)) }))
    .filter((i) => i.query.trim())
    .slice(0, MAX_ITEMS);
}

async function searchBox(page: Page, store: Store, query: string): Promise<void> {
  await page.goto(store.home, { waitUntil: "domcontentloaded", timeout: 20000 });
  const box = page.locator('input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], input[name="q"]').first();
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

async function runJob(page: Page, job: Job, allowPrivateHosts?: boolean): Promise<JobResult> {
  const { store, item } = job;
  const target = store.searchUrl?.(item.query) ?? store.home;
  const urlError = publicHttpUrlError(target, { allowPrivateHosts });
  if (urlError) return { store, item, tiles: [], error: urlError };
  try {
    if (store.searchUrl) await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20000 });
    else await searchBox(page, store, item.query);
    if (isBlockedUrl(page.url())) return { store, item, tiles: [], blocked: page.url() };
    await settle(page, store.scrolls ?? 3);
    const head = await page.evaluate(() => `${document.title}\n${document.body?.innerText.slice(0, 1500) ?? ""}`);
    if (BOT_WALL.test(head)) return { store, item, tiles: [], blocked: target };
    return { store, item, tiles: await extractTiles(page, { groupSelector: store.groupSelector, groupFromHref: store.groupFromHref }) };
  } catch (err) {
    return { store, item, tiles: [], error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

async function runAll(deps: Deps, jobs: Job[]): Promise<JobResult[]> {
  const results: JobResult[] = new Array(jobs.length);
  let next = 0;
  const worker = async (n: number) => {
    const page = await deps.pool.tab(deps.threadId, deps.userContext);
    const stop = n === 0 && deps.frames ? await watch(page, deps.frames).catch(() => undefined) : undefined;
    try {
      while (next < jobs.length) {
        const i = next++;
        results[i] = await runJob(page, jobs[i], deps.allowPrivateHosts);
      }
    } finally {
      await stop?.();
      await page.close().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(TABS, jobs.length) }, (_, n) => worker(n)));
  return results;
}

function storeResults(results: JobResult[], wanted: Item[]): StoreResult[] {
  const byStore = new Map<string, StoreResult>();
  const add = (label: string, home: string, item: Item, picks: Tile[]) => {
    const s = byStore.get(label) ?? { store: label, home, items: wanted.map((w) => ({ query: w.query, qty: w.qty, picks: [] as Tile[] })) };
    byStore.set(label, s);
    const slot = s.items.find((i) => i.query === item.query)!;
    if (!slot.picks.length) slot.picks = picks;
  };
  for (const r of results) {
    if (r.blocked || r.error) continue;
    if (r.store.marketplace) {
      const groups = new Map<string, Tile[]>();
      for (const t of r.tiles) if (t.group) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
      for (const [group, tiles] of groups) {
        const picks = rankTiles(r.item.query, tiles).slice(0, PICKS);
        if (picks.length) add(`${group} (${r.store.label})`, r.store.home, r.item, picks);
      }
    } else {
      add(r.store.label, r.store.home, r.item, rankTiles(r.item.query, r.tiles).slice(0, PICKS));
    }
  }
  return [...byStore.values()];
}

const money = (n: number) => `$${n.toFixed(2)}`;

function describeTile(t: Tile, n: number): string {
  const meta = [t.priceText ?? "price not shown", t.size, t.rating && `${t.rating}★`, t.sponsored && "sponsored"].filter(Boolean).join(" · ");
  return `  ${n}. ${t.title} — ${meta}\n     link: ${t.url}${t.image ? `\n     image: ${t.image}` : ""}`;
}

function render(stores: StoreResult[], results: JobResult[], wanted: Item[]): { text: string; summary: ReturnType<typeof bestValue> } {
  const summary = bestValue(stores).filter((s) => s.found > 0);
  const lines: string[] = [];
  const [best, ...rest] = summary;
  const of = (s: (typeof summary)[number]) => `${s.found} of ${wanted.length} items, ${money(s.total)}${s.missing.length ? ` (missing: ${s.missing.join(", ")})` : ""}`;
  if (best) lines.push(`Best value: ${best.store} — ${of(best)}`);
  if (rest.length) lines.push(`Others: ${rest.slice(0, 5).map((s) => `${s.store} ${of(s)}`).join("; ")}`);
  const seen = new Set<string>();
  for (const r of results) {
    if (seen.has(r.store.id)) continue;
    if (r.blocked) {
      seen.add(r.store.id);
      lines.push(`${r.store.label}: blocked by a bot check. Link for the user: ${r.blocked}`);
    }
  }
  for (const r of results) {
    if (seen.has(r.store.id) || r.blocked) continue;
    const ok = results.filter((x) => x.store.id === r.store.id && !x.error && x.tiles.length);
    if (!ok.length) {
      seen.add(r.store.id);
      const err = results.find((x) => x.store.id === r.store.id && x.error)?.error;
      lines.push(`${r.store.label}: no products read${err ? ` (${err})` : " (the store showed no results to the agent's browser)"}. Link for the user: ${r.store.searchUrl?.(wanted[0].query) ?? r.store.home}`);
    }
  }
  const shown = summary.slice(0, 3).map((s) => s.store);
  for (const s of stores.filter((x) => shown.includes(x.store)).sort((a, b) => shown.indexOf(a.store) - shown.indexOf(b.store))) {
    const full = s.store === best?.store;
    lines.push(`\n${s.store}:`);
    for (const i of s.items) {
      lines.push(`- ${i.query}${i.qty > 1 ? ` ×${i.qty}` : ""}:${i.picks.length ? "" : " not found"}`);
      i.picks.slice(0, full ? PICKS : 1).forEach((t, n) => lines.push(describeTile(t, n + 1)));
    }
  }
  return { text: lines.join("\n").trim(), summary };
}

export function shopTool(deps: Deps) {
  const resolve = deps.storeFor ?? defaultStoreFor;
  return defineTool({
    name: "shop",
    label: "Shop",
    description:
      "Search stores' real catalogs in a browser, as a guest, for a list of products. Returns, per store, the best matching catalog products (title, price, size, rating, product link, catalog image), items not found, and the best-value store. Stores: shipt (compares every nearby store it carries, such as Target, Safeway, Sprouts), amazon, target, walmart, costco, bestbuy, kroger, safeway, or any store's domain. Some stores block automated browsers; they come back as blocked with a link.",
    parameters: Type.Object({
      stores: Type.Union([Type.Array(Type.String()), Type.String()], { description: "1-3 stores, e.g. [\"shipt\"] or [\"amazon\", \"bestbuy\"]" }),
      items: Type.Union([Type.Array(Type.Object({ query: Type.String(), qty: Type.Optional(Type.Number()) })), Type.String()], {
        description: "products to find, up to 12, each a short catalog search like \"black beans 15 oz\" with qty",
      }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const wanted = items(params.items);
      const stores = list<string>(params.stores)
        .map((s) => resolve(String(s)))
        .filter((s): s is Store => !!s)
        .slice(0, MAX_STORES);
      if (!wanted.length || !stores.length) return fail("pass stores and items");
      const jobs = stores.flatMap((store) => wanted.map((item) => ({ store, item })));
      const results = await runAll(deps, jobs);
      const grouped = storeResults(results, wanted);
      const { text, summary } = render(grouped, results, wanted);
      return ok(text || "No products read from any store.", { data: { kind: "shop", stores: grouped, summary } });
    },
  });
}
