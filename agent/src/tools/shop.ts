import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Page } from "playwright";
import { Type } from "typebox";
import type { UserContext } from "../prompt/userContext.js";
import { ActiveCart, type CartItem } from "../shop/cart.js";
import type { Tile } from "../shop/extract.js";
import { currencyOf, formatMoney } from "../shop/currency.js";
import { bestValue, judgeRank, type Pick, rankTiles, SHORTLIST, type StoreResult } from "../shop/rank.js";
import type { Judge } from "../judge/index.js";
import { registry as defaultRegistry } from "../sources/index.js";
import type { SourceRegistry } from "../sources/registry.js";
import { browserSearch } from "../sources/retail/browser.js";
import { resolveStore } from "../sources/retail/resolve.js";
import { defaultStoresFor } from "../shop/stores.js";
import type { RetailCtx, RetailSource, Store } from "../sources/retail/types.js";
import { type FrameBus, watch } from "../browser/frames.js";
import type { BrowserPool } from "../browser/pool.js";
import { looseList } from "./args.js";
import { fail, ok, type ToolResult } from "./result.js";
import { log } from "../lib/log.js";

const MAX_STORES = 3;
const MAX_ITEMS = 12;
const TABS = 4;
const PICKS = 3;
const SCOPE = 3;
const RERANK_BUDGET_MS = 20000;

type Item = { query: string; qty: number };
export type Job = { store: Store; item: Item };
export type JobResult = { store: Store; item: Item; tiles: Tile[]; blocked?: string; error?: string };

type Deps = {
  pool: BrowserPool;
  threadId: string;
  userContext: UserContext | null;
  allowPrivateHosts?: boolean;
  storeFor?: (name: string) => Store | undefined;
  frames?: FrameBus;
  cart?: ActiveCart;
  judge?: Judge;
  search?: (jobs: Job[]) => Promise<JobResult[]>;
  region?: string;
  registry?: SourceRegistry;
  fetch?: typeof fetch;
  webSearch?: RetailCtx["webSearch"];
};

type Lane = { label: string; home: string; item: Item; tiles: Tile[]; grouped: boolean };

function items(v: unknown): Item[] {
  return looseList<unknown>(v)
    .map((x) =>
      typeof x === "string"
        ? { query: x, qty: 1 }
        : { query: String((x as Item).query ?? ""), qty: Math.max(1, Math.round(Number((x as Item).qty) || 1)) },
    )
    .filter((i) => i.query.trim())
    .slice(0, MAX_ITEMS);
}

async function runJob(page: Page, job: Job, deps: Deps): Promise<JobResult> {
  const { store, item } = job;
  const search = store.search ?? ((q, ctx) => browserSearch(store, q, ctx));
  const r = await search(
    { query: item.query },
    { page, allowPrivateHosts: deps.allowPrivateHosts, fetch: deps.fetch, webSearch: deps.webSearch },
  );
  return { store, item, tiles: r.tiles, ...(r.blocked && { blocked: r.blocked }), ...(r.error && { error: r.error }) };
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
        results[i] = await runJob(page, jobs[i], deps);
      }
    } finally {
      await stop?.();
      await page.close().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(TABS, jobs.length) }, (_, n) => worker(n)));
  return results;
}

function lanesOf(results: JobResult[]): Lane[] {
  return results.flatMap((r): Lane[] => {
    if (r.blocked || r.error) return [];
    if (!r.store.marketplace) return [{ label: r.store.label, home: r.store.home, item: r.item, tiles: r.tiles, grouped: false }];
    const groups = new Map<string, Tile[]>();
    for (const t of r.tiles) if (t.group) groups.set(t.group, [...(groups.get(t.group) ?? []), t]);
    return [...groups].map(([group, tiles]) => ({
      label: `${group} (${r.store.label})`,
      home: r.store.home,
      item: r.item,
      tiles,
      grouped: true,
    }));
  });
}

async function rankLanes(judge: Judge | undefined, lanes: Lane[]): Promise<Pick[][]> {
  const keyword = (l: Lane) => rankTiles(l.item.query, l.tiles);
  if (!judge) return lanes.map(keyword);
  if (!judge.available) {
    log.info("[shop] rerank fallback reason=unavailable");
    return lanes.map(keyword);
  }
  const started = Date.now();
  const signal = AbortSignal.timeout(RERANK_BUDGET_MS);
  let tiles = 0;
  const failed: string[] = [];
  const ranked = await Promise.all(
    lanes.map(async (l) => {
      tiles += Math.min(l.tiles.length, SHORTLIST);
      const picks = await judgeRank(judge, l.item.query, l.tiles, { signal, batch: true }).catch(() => null);
      if (picks) return picks;
      failed.push(l.item.query);
      return keyword(l);
    }),
  );
  if (failed.length)
    log.info(`[shop] rerank fallback reason=${signal.aborted ? "budget" : "judge"} lanes=${failed.length}/${lanes.length}`);
  log.debug(`[shop] rerank ms=${Date.now() - started} tiles=${tiles}`);
  return ranked;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const carries = (group: string | undefined, store: Store) =>
  !!group && (norm(group).includes(norm(store.label)) || norm(store.label).includes(norm(group)));

type Search = (jobs: Job[]) => Promise<JobResult[]>;

async function viaMarketplace(
  market: Store | undefined,
  stores: Store[],
  results: JobResult[],
  wanted: Item[],
  run: Search,
): Promise<{ results: JobResult[]; routed: Store[] } | null> {
  if (!market || !wanted.length || stores.some((s) => s.id === market.id)) return null;
  const stuck = stores.filter(
    (s) => !s.marketplace && results.filter((r) => r.store.id === s.id).every((r) => r.blocked || r.error || !r.tiles.length),
  );
  if (!stuck.length) return null;
  const found = await run(wanted.map((item) => ({ store: market, item })));
  const kept = found.map((r) => ({ ...r, tiles: r.tiles.filter((t) => stuck.some((s) => carries(t.group, s))) }));
  return { results: kept, routed: stuck.filter((s) => kept.some((r) => r.tiles.some((t) => carries(t.group, s)))) };
}

function storeResults(lanes: Lane[], ranked: Pick[][], wanted: Item[]): StoreResult[] {
  const byStore = new Map<string, StoreResult>();
  lanes.forEach((l, n) => {
    const picks = ranked[n].slice(0, PICKS);
    if (l.grouped && !picks.length) return;
    const s = byStore.get(l.label) ?? {
      store: l.label,
      home: l.home,
      items: wanted.map((w) => ({ query: w.query, qty: w.qty, picks: [] as Pick[] })),
    };
    byStore.set(l.label, s);
    const slot = s.items.find((i) => i.query === l.item.query)!;
    if (!slot.picks.length) slot.picks = picks;
  });
  return [...byStore.values()];
}

type Summary = ReturnType<typeof bestValue>;

function describeTile(t: Pick, n: number): string {
  const meta = [
    t.priceText ?? "price not shown",
    t.size,
    t.rating && `${t.rating}★`,
    t.sponsored && "sponsored",
    t.match === "substitute" && "substitute",
  ]
    .filter(Boolean)
    .join(" · ");
  return `  ${n}. ${t.title} — ${meta}\n     link: ${t.url}${t.image ? `\n     image: ${t.image}` : ""}`;
}

function summaryLines(summary: Summary, stores: StoreResult[], wanted: number): string[] {
  const currency = new Map(stores.map((s) => [s.store, currencyOf(s.items)]));
  const of = (s: Summary[number]) =>
    `${s.found} of ${wanted} items, ${formatMoney(s.total, currency.get(s.store))}${s.missing.length ? ` (missing: ${s.missing.join(", ")})` : ""}${s.substitutes?.length ? ` (substitutes only: ${s.substitutes.join(", ")})` : ""}`;
  const [best, ...rest] = summary;
  return [
    ...(best ? [`Best value: ${best.store} — ${of(best)}`] : []),
    ...(rest.length
      ? [
          `Others: ${rest
            .slice(0, 5)
            .map((s) => `${s.store} ${of(s)}`)
            .join("; ")}`,
        ]
      : []),
  ];
}

function problemLines(results: JobResult[], firstQuery: string): string[] {
  const lines: string[] = [];
  const reported = new Set<string>();
  for (const r of results) {
    if (r.blocked && !reported.has(r.store.id)) {
      reported.add(r.store.id);
      lines.push(`${r.store.label}: blocked by a bot check. Link for the user: ${r.blocked}`);
    }
  }
  for (const r of results) {
    if (reported.has(r.store.id)) continue;
    const mine = results.filter((x) => x.store.id === r.store.id);
    if (mine.some((x) => !x.error && x.tiles.length)) continue;
    reported.add(r.store.id);
    const err = mine.find((x) => x.error)?.error;
    lines.push(
      `${r.store.label}: no products read${err ? ` (${err})` : " (the store showed no results to the agent's browser)"}. Link for the user: ${r.store.searchUrl?.(firstQuery) ?? r.store.home}`,
    );
  }
  return lines;
}

function storeLines(stores: StoreResult[], summary: Summary): string[] {
  const shown = summary.slice(0, 3).map((s) => s.store);
  const best = shown[0];
  return stores
    .filter((x) => shown.includes(x.store))
    .sort((a, b) => shown.indexOf(a.store) - shown.indexOf(b.store))
    .flatMap((s) => [
      `\n${s.store}:`,
      ...s.items.flatMap((i) => [
        `- ${i.query}${i.qty > 1 ? ` ×${i.qty}` : ""}:${i.picks.length ? (i.picks[0].match === "substitute" ? " no exact match, substitutes" : "") : " not found"}`,
        ...i.picks.slice(0, s.store === best ? PICKS : 1).map((t, n) => describeTile(t, n + 1)),
      ]),
    ]);
}

function render(stores: StoreResult[], results: JobResult[], wanted: Item[]): { text: string; summary: Summary } {
  const summary = bestValue(stores).filter((s) => s.found > 0);
  const lines = [
    ...summaryLines(summary, stores, wanted.length),
    ...problemLines(results, wanted[0].query),
    ...storeLines(stores, summary),
  ];
  return { text: lines.join("\n").trim(), summary };
}

function shopDescription(registry: SourceRegistry, region: string | undefined, resolve: (name: string) => Store | undefined): string {
  const grocery = defaultStoresFor(region ?? "US", "grocery");
  const general = defaultStoresFor(region ?? "US", "general");
  const market = grocery.find((id) => resolve(id)?.marketplace);
  const viaMarket = market
    ? ` Groceries from a store ${market} carries: pass ${market}, which reads that store's real prices; the store's own site usually blocks guests.`
    : "";
  return `Build the chat's one shopping cart from stores' real catalogs, browsing as a guest. First call: items with qty and 1-3 stores; it keeps the best-value stores. For follow-ups ("add tortillas", "make it for 6") pass only the new items, no stores. remove drops items; pass stores again only to switch stores, new_cart only for an unrelated list. Use the store the user named, else the defaults for their region: groceries ${grocery.join(", ")}; other products ${general.join(", ")}.${viaMarket} ${storesHelp(registry, region)}

It shows its own cart card (products, prices, links, best value), so don't repeat products in show_ui and never use image_search pictures for products. For recipes skip pantry basics. Reply in a sentence or two: best-value store, how much cheaper than the next, missing items.`;
}

function storesHelp(registry: SourceRegistry, region?: string): string {
  const listed = registry.select<RetailSource>({ vertical: "retail", region }).map((s) => `${s.id}${s.note ? ` (${s.note})` : ""}`);
  return `Stores for the user's region: ${listed.join(", ")}. Any other store's domain also works: its product pages are read for prices. A store that blocks automated access comes back as blocked with a link for the user: give them the link, and don't retry it with fetch_page, browse or web_search.`;
}

export function shopTool(deps: Deps) {
  const registry = deps.registry ?? defaultRegistry;
  const resolve = deps.storeFor ?? ((name: string) => resolveStore(registry, name));
  const fallbackCart = new ActiveCart();
  return defineTool({
    name: "shop",
    label: "Shop",
    description: shopDescription(registry, deps.region, resolve),
    parameters: Type.Object({
      stores: Type.Optional(
        Type.Union([Type.Array(Type.String()), Type.String()], {
          description: '1-3 stores for a new cart or to switch stores, e.g. ["shipt"] or ["amazon", "bestbuy"]',
        }),
      ),
      items: Type.Optional(
        Type.Union([Type.Array(Type.Object({ query: Type.String(), qty: Type.Optional(Type.Number()) })), Type.String()], {
          description: 'products to add, up to 12, each a short catalog search like "black beans 15 oz" with qty',
        }),
      ),
      remove: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()], { description: "item queries to drop from the cart" })),
      new_cart: Type.Optional(Type.Boolean({ description: "start a new, unrelated cart" })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const cart = deps.cart ?? fallbackCart;
      const asked = items(params.items);
      const picked = looseList<string>(params.stores)
        .map((x) => resolve(String(x)))
        .filter((x): x is Store => !!x)
        .slice(0, MAX_STORES);
      const ids = picked.map((x) => x.id);
      if (params.remove) cart.remove(looseList<string>(params.remove).map(String));
      const switching = ids.length > 0 && !(ids.length === cart.stores.length && ids.every((id) => cart.stores.includes(id)));
      let added: CartItem[];
      let search: CartItem[];
      let fresh = false;
      if (params.new_cart || !cart.stores.length) {
        if (!asked.length) return fail("pass items to add");
        if (!picked.length) {
          const region = deps.region ?? "US";
          return fail(
            `pass stores for this new cart: the store the user named, else this region's defaults (groceries ${defaultStoresFor(region, "grocery").join(", ")}; other products ${defaultStoresFor(region, "general").join(", ")})`,
          );
        }
        cart.start(ids, asked);
        added = cart.items;
        search = cart.items;
        fresh = true;
      } else if (switching) {
        added = cart.add(asked);
        cart.start(
          ids,
          cart.items.map((i) => ({ ...i })),
        );
        search = cart.items;
        fresh = true;
      } else {
        added = cart.add(asked);
        search = added;
      }
      if (!cart.items.length) {
        cart.save();
        return ok("The cart is empty.", { data: { kind: "shop", stores: [], summary: [] } });
      }
      const stores = cart.stores.map((id) => resolve(id)).filter((x): x is Store => !!x);
      const run: Search = deps.search ?? ((jobs) => runAll(deps, jobs));
      const results = search.length ? await run(stores.flatMap((store) => search.map((item) => ({ store, item })))) : [];
      const market = defaultStoresFor(deps.region ?? "US", "grocery")
        .map((id) => resolve(id))
        .find((x): x is Store => !!x?.marketplace);
      const via = await viaMarketplace(market, stores, results, search, run);
      if (via?.routed.length && market)
        cart.stores = [...new Set([...cart.stores.filter((id) => !via.routed.some((s) => s.id === id)), market.id])];
      const lanes = lanesOf([...results, ...(via?.results ?? [])]);
      cart.addResults(storeResults(lanes, await rankLanes(deps.judge, lanes), search));
      if (fresh)
        cart.scopeTo(
          bestValue(cart.view())
            .filter((x) => x.found > 0)
            .slice(0, SCOPE)
            .map((x) => x.store),
        );
      cart.save();
      const view = cart.view();
      const { text: body, summary } = render(view, results, cart.items);
      const routedNote =
        via?.routed.map((x) => `${x.label} blocked direct browsing, so its prices were read through ${market?.label}.`).join(" ") ?? "";
      const text = [routedNote, body].filter(Boolean).join("\n");
      const n = cart.items.length;
      const head = `Cart: ${n} ${n === 1 ? "item" : "items"} at ${cart.scope.join(", ") || stores.map((x) => x.label).join(", ")}.${added.length && !fresh ? ` Added: ${added.map((i) => i.query).join(", ")}.` : ""} Later additions stay at these stores.`;
      return ok(`${head}\n${text || "No products read from any store."}`, { data: { kind: "shop", stores: view, summary } });
    },
  });
}
