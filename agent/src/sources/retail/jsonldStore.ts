import type { Tile } from "../../shop/extract.js";
import { formatMoney } from "../../shop/currency.js";
import { BOT_WALL } from "../../tools/browsePolicy.js";
import { BLOCKING_STATUSES, fetchPublic, readCapped, timeoutSignal } from "../../tools/net.js";
import { type LdRecord, parseJsonLd } from "../jsonld.js";
import type { RetailCtx, RetailQuery, RetailResult, RetailSource } from "./types.js";

const MAX_PAGES = 4;
const MAX_BYTES = 2_000_000;
const GUESSES = ["/search?q=", "/search?query=", "/s?k="];

type Read = { url: string; tiles: Tile[]; blocked?: boolean; error?: string };

export function tileOf(r: LdRecord, pageUrl: string): Tile | null {
  if (r.kind !== "product") return null;
  const out = r.availability && /OutOfStock|SoldOut|Discontinued/i.test(r.availability);
  const priceText = r.price != null ? `${formatMoney(r.price, r.currency)}${out ? " (out of stock)" : ""}` : undefined;
  return {
    title: r.brand && !r.name.toLowerCase().includes(r.brand.toLowerCase()) ? `${r.brand} ${r.name}` : r.name,
    ...(r.price != null && !out && { price: r.price }),
    ...(priceText && { priceText }),
    ...(r.image && { image: r.image }),
    url: r.url ?? pageUrl,
    sponsored: false,
    ...(r.rating != null && { rating: r.rating }),
  };
}

async function readPage(url: string, ctx: RetailCtx): Promise<Read> {
  try {
    const { res, url: at } = await fetchPublic(
      ctx.fetch ?? fetch,
      url,
      {
        signal: timeoutSignal(15000, ctx.signal),
        headers: { "user-agent": "Mozilla/5.0 (compatible; OpenAgent/0.1)", accept: "text/html" },
      },
      { allowPrivateHosts: ctx.allowPrivateHosts, lookup: ctx.lookup },
    );
    if (BLOCKING_STATUSES.has(res.status)) return { url, tiles: [], blocked: true };
    if (!res.ok) return { url, tiles: [], error: `HTTP ${res.status}` };
    const html = await readCapped(res, MAX_BYTES);
    const tiles = parseJsonLd(html, at)
      .map((r) => tileOf(r, at))
      .filter((t): t is Tile => !!t);
    if (!tiles.length && BOT_WALL.test(html.slice(0, 3000))) return { url, tiles: [], blocked: true };
    return { url, tiles };
  } catch (err) {
    return { url, tiles: [], error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

function onSite(link: string, domain: string): boolean {
  try {
    const u = new URL(link);
    if (domain.includes(":")) return u.host === domain;
    const h = u.hostname.replace(/^www\./, "");
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export function jsonldStore(domain: string, home = `https://www.${domain}/`): RetailSource {
  const host = domain.replace(/^www\./, "");
  const origin = new URL(home).origin;
  const store: RetailSource = {
    id: domain,
    label: domain,
    home,
    vertical: "retail",
    regions: ["*"],
    capabilities: ["search", "price", "jsonld"],
    domains: [domain],
    async search(q: RetailQuery, ctx: RetailCtx): Promise<RetailResult> {
      const hits = ctx.webSearch ? await ctx.webSearch(`site:${host} ${q.query}`).catch(() => []) : [];
      const found = [...new Set(hits.map((h) => h.url).filter((u) => onSite(u, host)))].slice(0, MAX_PAGES);
      const urls = found.length ? found : GUESSES.map((g) => `${origin}${g}${encodeURIComponent(q.query)}`);
      const reads = await Promise.all(urls.map((u) => readPage(u, ctx)));
      const seen = new Set<string>();
      const tiles = reads.flatMap((r) => r.tiles).filter((t) => !seen.has(t.url) && seen.add(t.url));
      if (tiles.length) return { tiles };
      const blocked = reads.find((r) => r.blocked);
      if (blocked) return { tiles: [], blocked: blocked.url };
      const error = reads.find((r) => r.error)?.error;
      return { tiles: [], ...(error && { error }) };
    },
  };
  return store;
}
