import type { StoredMessage } from "@oab/shared/chats";
import { type Cart, type Plan, validateWidget } from "@oab/shared/widgets";
import { clip, entityDetail, money, oneLine } from "./summary.js";

export type EarlierCards = {
  cart?: { at: string; card: Cart };
  plans: { at: string; card: Plan }[];
};

const PLAN_LINES = 3;

function widgetOf(args: string): Cart | Plan | undefined {
  let raw: unknown;
  try {
    raw = (JSON.parse(args) as { widget?: unknown } | null)?.widget;
  } catch {
    return undefined;
  }
  const kind = (raw as { kind?: unknown } | null)?.kind;
  if (kind !== "cart" && kind !== "plan") return undefined;
  const valid = validateWidget(raw);
  return valid.ok ? (valid.value as Cart | Plan) : undefined;
}

export function earlierCards(rows: readonly StoredMessage[]): EarlierCards {
  let cart: EarlierCards["cart"];
  const plans = new Map<string, { at: string; card: Plan }>();
  for (const row of rows) {
    for (const part of row.parts ?? []) {
      if (part.type !== "tool" || part.name !== "show_widget") continue;
      const card = widgetOf(part.args);
      if (card?.kind === "cart") cart = { at: row.createdAt, card };
      else if (card?.kind === "plan") {
        const key = `${card.entity}:${card.id}`;
        plans.delete(key);
        plans.set(key, { at: row.createdAt, card });
      }
    }
  }
  return { ...(cart && { cart }), plans: [...plans.values()].reverse().slice(0, PLAN_LINES) };
}

const DAY = { month: "short", day: "numeric", year: "numeric" } as const;

function shownOn(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "an unknown date";
  try {
    if (timeZone) return new Intl.DateTimeFormat("en-US", { ...DAY, timeZone }).format(at);
  } catch {}
  return `${new Intl.DateTimeFormat("en-US", { ...DAY, timeZone: "UTC" }).format(at)} UTC`;
}

const qty = (n: number) => (n === 1 ? "" : ` ×${n}`);

function cartLine({ at, card }: NonNullable<EarlierCards["cart"]>, timeZone?: string): string {
  const items = card.stores[0].items.map((i) => `${i.query}${qty(i.qty)}`).join(", ");
  const names = card.stores.map((s) => s.name).join(", ");
  const complete = card.stores.filter((s) => !s.missing.length);
  const best = (complete.length ? complete : card.stores).reduce((a, b) => (b.total < a.total ? b : a));
  return `cart (shown ${shownOn(at, timeZone)}): ${items} at ${names}; best ${money(best.total, best.currency)} at ${best.name}`;
}

const planLine = ({ at, card }: EarlierCards["plans"][number], timeZone?: string) =>
  `${card.entity} ${card.id} (shown ${shownOn(at, timeZone)}): ${entityDetail({ kind: card.entity, id: card.id, value: card.value })}`;

const EARLIER_HEAD =
  "Cards shown earlier in this chat. They are read-only and nothing from them is live in this session. Prices and availability are from the date shown and may have changed. If the user wants to continue one, search again (shop with new_cart, the items and the stores) or set the plan again; don't quote these totals as current.";

type NoteOptions = { cartLive: boolean; plansLive: boolean; timeZone?: string };

export function earlierNote(cards: EarlierCards | undefined, { cartLive, plansLive, timeZone }: NoteOptions): string | undefined {
  if (!cards) return undefined;
  const lines = [
    ...(cards.cart && !cartLive ? [cartLine(cards.cart, timeZone)] : []),
    ...(plansLive ? [] : cards.plans.map((p) => planLine(p, timeZone))),
  ];
  if (!lines.length) return undefined;
  return `<earlier_cards>\n${EARLIER_HEAD}\n${clip(lines.map(oneLine).join("\n"))}\n</earlier_cards>`;
}
