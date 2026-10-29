import { keyWords } from "../lib/keywords.js";
import type { Judge } from "../judge/index.js";
import { productMatch } from "../judge/criteria/productMatch.js";
import type { Tile } from "./extract.js";

export type Match = "exact" | "substitute";
export type Pick = Tile & { match?: Match; why?: string };
export type ItemResult = { query: string; qty: number; picks: Pick[] };
export type StoreResult = { store: string; home?: string; items: ItemResult[] };
export type StoreSummary = { store: string; found: number; missing: string[]; total: number; substitutes?: string[] };

export function matches(query: string, title: string): boolean {
  const want = [...new Set(keyWords(query))];
  if (!want.length) return false;
  const have = new Set(keyWords(title));
  const words = keyWords(query);
  if (!have.has(words[words.length - 1])) return false;
  return want.filter((w) => have.has(w)).length >= Math.max(1, Math.ceil(want.length * 0.6));
}

const DERIVED = ["chip", "crisp", "flavor", "flavored", "flavour", "seasoning", "mix", "sauce", "dip", "snack", "candy", "cracker", "dressing", "pickle", "kit", "bar", "cereal", "soup", "drink", "juice", "spray", "powder", "wild"];

function fullMatch(query: string, title: string): boolean {
  const have = new Set(keyWords(title));
  return keyWords(query).every((w) => have.has(w));
}

function derived(query: string, title: string): boolean {
  const asked = new Set(keyWords(query));
  return keyWords(title).some((w) => DERIVED.includes(w) && !asked.has(w));
}

export function rankTiles(query: string, tiles: Tile[]): Tile[] {
  const price = (t: Tile) => t.price ?? Number.POSITIVE_INFINITY;
  const form = (t: Tile) => Number(derived(query, t.title));
  return tiles
    .filter((t) => matches(query, t.title) && !(derived(query, t.title) && !fullMatch(query, t.title)))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => form(a.t) - form(b.t) || Number(a.t.sponsored) - Number(b.t.sponsored) || price(a.t) - price(b.t) || a.i - b.i)
    .map(({ t }) => t);
}

export const SHORTLIST = 20;

export function shortlist(query: string, tiles: Tile[], limit = SHORTLIST): Tile[] {
  if (tiles.length <= limit) return tiles;
  const want = [...new Set(keyWords(query))];
  const last = keyWords(query).at(-1);
  const score = (t: Tile) => {
    const have = new Set(keyWords(t.title));
    return want.filter((w) => have.has(w)).length / Math.max(1, want.length) + (last && have.has(last) ? 0.5 : 0);
  };
  return tiles
    .map((t, i) => ({ t, i, s: score(t) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map(({ t }) => t);
}

const LEVEL_ORDER: Record<Match, number> = { exact: 0, substitute: 1 };

export async function judgeRank(judge: Judge, query: string, tiles: Tile[], opts: { signal?: AbortSignal; limit?: number; batch?: boolean } = {}): Promise<Pick[] | null> {
  const short = shortlist(query, tiles, opts.limit);
  if (!short.length) return [];
  const scored = await judge.score(
    short.map((t, i) => ({ id: String(i), state: { ...(!opts.batch && { query }), product: t.title, ...(t.size && { size: t.size }) } })),
    productMatch,
    { signal: opts.signal, ...(opts.batch && { batch: { shared: { query } } }) },
  );
  if (!scored) return null;
  const price = (t: Tile) => t.price ?? Number.POSITIVE_INFINITY;
  return scored
    .flatMap((s) => (s.level === "exact" || s.level === "substitute" ? [{ t: short[Number(s.id)], i: Number(s.id), match: s.level as Match, p: s.p }] : []))
    .sort((a, b) => LEVEL_ORDER[a.match] - LEVEL_ORDER[b.match] || Number(a.t.sponsored) - Number(b.t.sponsored) || price(a.t) - price(b.t) || a.i - b.i)
    .map(({ t, match, p }) => ({ ...t, match, why: `${match}, ${Math.round(p * 100)}%` }));
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function bestValue(stores: StoreResult[]): StoreSummary[] {
  return stores
    .map((s) => {
      const exact = (i: ItemResult) => i.picks.length > 0 && i.picks[0].match !== "substitute";
      const found = s.items.filter(exact);
      const substitutes = s.items.filter((i) => i.picks.length && !exact(i)).map((i) => i.query);
      return {
        store: s.store,
        found: found.length,
        missing: s.items.filter((i) => !i.picks.length).map((i) => i.query),
        total: cents(found.reduce((sum, i) => sum + (i.picks[0].price ?? 0) * i.qty, 0)),
        ...(substitutes.length && { substitutes }),
      };
    })
    .sort((a, b) => b.found - a.found || a.total - b.total);
}
