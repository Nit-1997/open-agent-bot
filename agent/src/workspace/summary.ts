import type { CartEntity, EntityKind, EventEntity, ShortlistEntity, TripEntity } from "../../../shared/workspace.js";
import { ActiveCart } from "../shop/cart.js";
import { currencyOf, formatMoney } from "../shop/currency.js";
import { bestValue } from "../shop/rank.js";

export type StoredEntity = { kind: EntityKind; id: string; value: unknown };

export const SUMMARY_LIMIT = 600;

export const money = (n: number, currency?: string) => formatMoney(n, currency).replace(/\.00$/, "");

export const clip = (text: string) => (text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : text);

export const oneLine = (text: string) => text.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

function cartDetail(c: CartEntity): string {
  const view = ActiveCart.from(c).view();
  const best = bestValue(view).find((s) => s.found > 0);
  const at = c.scope.length ? c.scope.join(", ") : c.stores.join(", ");
  const n = c.items.length;
  const price = best
    ? ` (best ${money(best.total, currencyOf(view.find((v) => v.store === best.store)?.items ?? []))} at ${best.store})`
    : "";
  return `${n} ${n === 1 ? "item" : "items"} at ${at || "no store yet"}${price}`;
}

function eventDetail(e: EventEntity): string {
  const parts = [
    e.title,
    `${e.guests} guests`,
    e.date,
    e.budget !== undefined && `budget ${money(e.budget, e.currency)}`,
    e.location,
  ].filter(Boolean);
  return parts.join(", ");
}

function tripDetail(t: TripEntity): string {
  const parts = [
    t.destination,
    `${t.start} to ${t.end}`,
    `${t.travelers} traveler${t.travelers === 1 ? "" : "s"}`,
    t.budget !== undefined && `budget ${money(t.budget)}`,
    t.stays.length > 0 && `${t.stays.length} stays shortlisted`,
    t.days.length > 0 && `${t.days.length} days planned`,
  ].filter(Boolean);
  return parts.join(", ");
}

function shortlistDetail(s: ShortlistEntity): string {
  return `${s.title}, ${s.items.length} ${s.items.length === 1 ? "item" : "items"}`;
}

export function entityDetail(e: StoredEntity): string {
  switch (e.kind) {
    case "cart":
      return cartDetail(e.value as CartEntity);
    case "event":
      return eventDetail(e.value as EventEntity);
    case "trip":
      return tripDetail(e.value as TripEntity);
    case "shortlist":
      return shortlistDetail(e.value as ShortlistEntity);
  }
}

const line = (e: StoredEntity): string => oneLine(e.kind === "cart" ? `cart: ${entityDetail(e)}` : `${e.kind} ${e.id}: ${entityDetail(e)}`);

export function summarize(entities: StoredEntity[]): string {
  return clip(entities.map(line).join("; "));
}
