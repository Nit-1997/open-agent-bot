import { currencyOf } from "../shop/currency.js";
import type { StoreResult } from "../shop/rank.js";

export const MAX_CART_STORES = 6;
const MAX_PICKS = 3;
const CART_FIELDS = ["title", "price", "priceText", "image", "url", "size", "rating", "sponsored", "match", "why"];

export type StoreTotal = { store: string; total: number; missing: string[] };

type StoreView = { store: string; home?: string; items: Array<{ query: string; qty: number; picks: ReadonlyArray<object> }> };

export function toCartStore(view: StoreView, sum: StoreTotal) {
  const currency = currencyOf(view.items as unknown as StoreResult["items"]);
  return {
    name: sum.store,
    total: sum.total,
    ...(currency && { currency }),
    url: view.home ?? "",
    missing: sum.missing,
    items: view.items.map((i) => ({
      query: i.query,
      qty: i.qty,
      picks: i.picks
        .slice(0, MAX_PICKS)
        .map((p) =>
          Object.fromEntries(
            CART_FIELDS.filter((k) => (p as Record<string, unknown>)[k] !== undefined).map((k) => [k, (p as Record<string, unknown>)[k]]),
          ),
        ),
    })),
  };
}
