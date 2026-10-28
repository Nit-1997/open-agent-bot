import { keyWords } from "../tools/webSearch.js";
import type { Tile } from "./extract.js";

export type ItemResult = { query: string; qty: number; picks: Tile[] };
export type StoreResult = { store: string; items: ItemResult[] };
export type StoreSummary = { store: string; found: number; missing: string[]; total: number };

export function matches(query: string, title: string): boolean {
  const want = [...new Set(keyWords(query))];
  if (!want.length) return false;
  const have = new Set(keyWords(title));
  const words = keyWords(query);
  if (!have.has(words[words.length - 1])) return false;
  return want.filter((w) => have.has(w)).length >= Math.max(1, Math.ceil(want.length * 0.6));
}

export function rankTiles(query: string, tiles: Tile[]): Tile[] {
  const price = (t: Tile) => t.price ?? Number.POSITIVE_INFINITY;
  return tiles
    .filter((t) => matches(query, t.title))
    .map((t, i) => ({ t, i }))
    .sort((a, b) => Number(a.t.sponsored) - Number(b.t.sponsored) || price(a.t) - price(b.t) || a.i - b.i)
    .map(({ t }) => t);
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function bestValue(stores: StoreResult[]): StoreSummary[] {
  return stores
    .map((s) => {
      const found = s.items.filter((i) => i.picks.length);
      return {
        store: s.store,
        found: found.length,
        missing: s.items.filter((i) => !i.picks.length).map((i) => i.query),
        total: cents(found.reduce((sum, i) => sum + (i.picks[0].price ?? 0) * i.qty, 0)),
      };
    })
    .sort((a, b) => b.found - a.found || a.total - b.total);
}
