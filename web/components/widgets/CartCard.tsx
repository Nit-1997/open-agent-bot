"use client";

import type { Cart } from "@shared/widgets";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Picture } from "./CardRow";

type Line = { qty: number; choice: number; removed: boolean };
type Store = Cart["stores"][number];

const money = (n: number) => `$${n.toFixed(2)}`;
const portalOf = (name: string) => name.match(/\(([^)]+)\)\s*$/)?.[1] ?? name;

function initial(store: Store): Line[] {
  return store.items.map((i) => ({ qty: i.qty, choice: 0, removed: false }));
}

export function CartCard({ toolCallId, widget }: { toolCallId: string; widget: Cart }) {
  const id = `cart-${toolCallId}`;
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<Record<number, Line[]>>({});
  const [swapping, setSwapping] = useState<number | null>(null);
  const store = widget.stores[active];
  const current = lines[active] ?? initial(store);
  const update = (i: number, patch: Partial<Line>) => setLines((all) => ({ ...all, [active]: current.map((l, n) => (n === i ? { ...l, ...patch } : l)) }));

  const inCart = store.items.map((item, i) => ({ item, line: current[i], pick: item.picks[current[i].choice], i })).filter((x) => x.pick);
  const kept = inCart.filter((x) => !x.line.removed);
  const subtotal = kept.reduce((sum, x) => sum + (x.pick.price ?? 0) * x.line.qty, 0);
  const unpriced = kept.filter((x) => x.pick.price === undefined).length;
  const missing = store.items.filter((i) => !i.picks.length);
  const portal = portalOf(store.name);

  return (
    <section id={id} className="my-2 w-full rounded-2xl border border-border bg-paper p-4">
      <header id={`${id}-header`} className="flex items-baseline justify-between gap-2">
        <h3 id={`${id}-title`} className="text-base font-semibold">
          Cart
        </h3>
        <span id={`${id}-count`} className="text-xs text-text-muted">
          {kept.length} {kept.length === 1 ? "item" : "items"}
        </span>
      </header>

      <div id={`${id}-tabs`} role="tablist" aria-label="Stores" className="mt-2 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {widget.stores.map((s, n) => (
          <button
            id={`${id}-tab-${n}`}
            key={n}
            type="button"
            role="tab"
            aria-selected={n === active}
            onClick={() => {
              setActive(n);
              setSwapping(null);
            }}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition ${n === active ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-paper text-text-secondary hover:border-border-strong"}`}
          >
            <span id={`${id}-tab-${n}-name`}>{s.name}</span>
            <span id={`${id}-tab-${n}-total`} className="font-semibold">
              {money(s.total)}
            </span>
            {n === 0 && widget.stores.length > 1 && (
              <span id={`${id}-tab-${n}-best`} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${n === active ? "bg-paper/20" : "bg-success-bg text-success-fg"}`}>
                Best value
              </span>
            )}
          </button>
        ))}
      </div>

      <div id={`${id}-body`} className="mt-3 grid gap-4 sm:grid-cols-[1fr_200px]">
        <div id={`${id}-lines`}>
          <ul id={`${id}-list`} className="divide-y divide-border">
            {inCart
              .filter((x) => !x.line.removed)
              .map(({ item, line, pick, i }) => {
                const rid = `${id}-s${active}-i${i}`;
                return (
                  <li id={rid} key={`${active}-${i}`} aria-label={item.query} className="py-3">
                    <div id={`${rid}-row`} className="flex gap-3">
                      <div id={`${rid}-media`} className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white">
                        <Picture id={`${rid}-img`} src={pick.image} alt={pick.title} fallback={pick.title} className="h-full w-full object-contain p-1" />
                      </div>
                      <div id={`${rid}-info`} className="min-w-0 flex-1">
                        <a id={`${rid}-link`} href={pick.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-sm font-medium text-text-primary hover:underline">
                          {pick.title}
                        </a>
                        <p id={`${rid}-meta`} className="mt-0.5 text-xs text-text-muted">
                          <span id={`${rid}-price`} className="font-semibold text-text-primary">
                            {pick.priceText ?? "Price not shown"}
                          </span>
                          {pick.size && <span id={`${rid}-size`}> · {pick.size}</span>}
                          {pick.sponsored && <span id={`${rid}-ad`}> · Sponsored</span>}
                        </p>
                        {item.picks.length > 1 && (
                          <button
                            id={`${rid}-swap`}
                            type="button"
                            onClick={() => setSwapping(swapping === i ? null : i)}
                            className="mt-1 text-xs font-medium text-text-secondary underline underline-offset-4 hover:text-text-primary"
                          >
                            Swap
                          </button>
                        )}
                      </div>
                      <div id={`${rid}-controls`} className="flex shrink-0 flex-col items-end gap-2">
                        <div id={`${rid}-qty`} className="flex items-center rounded-full border border-border">
                          <button id={`${rid}-dec`} type="button" aria-label="Decrease quantity" disabled={line.qty <= 1} onClick={() => update(i, { qty: line.qty - 1 })} className="p-1.5 text-text-secondary disabled:opacity-30">
                            <Minus size={12} />
                          </button>
                          <span id={`${rid}-qty-n`} className="w-5 text-center text-sm">
                            {line.qty}
                          </span>
                          <button id={`${rid}-inc`} type="button" aria-label="Increase quantity" onClick={() => update(i, { qty: line.qty + 1 })} className="p-1.5 text-text-secondary">
                            <Plus size={12} />
                          </button>
                        </div>
                        <button id={`${rid}-remove`} type="button" aria-label="Remove" onClick={() => update(i, { removed: true })} className="rounded-full bg-surface p-1.5 text-text-secondary hover:text-text-primary">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    {swapping === i && (
                      <div id={`${rid}-alts`} className="ml-[76px] mt-2 space-y-1">
                        {item.picks.map((alt, n) =>
                          n === line.choice ? null : (
                            <button
                              id={`${rid}-alt-${n}`}
                              key={n}
                              type="button"
                              onClick={() => {
                                update(i, { choice: n });
                                setSwapping(null);
                              }}
                              className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1 text-left text-xs hover:border-border-strong"
                            >
                              <span id={`${rid}-alt-${n}-media`} className="h-8 w-8 shrink-0 overflow-hidden rounded bg-white">
                                <Picture id={`${rid}-alt-${n}-img`} src={alt.image} alt="" fallback={alt.title} className="h-full w-full object-contain" />
                              </span>
                              <span id={`${rid}-alt-${n}-title`} className="line-clamp-1 flex-1">
                                {alt.title}
                              </span>
                              <span id={`${rid}-alt-${n}-price`} className="font-semibold">
                                {alt.priceText ?? ""}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            {missing.map((item) => (
              <li id={`${id}-s${active}-missing-${store.items.indexOf(item)}`} key={`m-${item.query}`} aria-label={item.query} className="py-2 text-xs text-warn-fg">
                Not found: {item.query}
              </li>
            ))}
          </ul>
          {inCart.some((x) => x.line.removed) && (
            <div id={`${id}-removed`} className="mt-2 flex flex-wrap gap-2 text-xs text-text-muted">
              {inCart
                .filter((x) => x.line.removed)
                .map(({ item, i }) => (
                  <button
                    id={`${id}-s${active}-restore-${i}`}
                    key={i}
                    type="button"
                    aria-label={`Add back ${item.query}`}
                    onClick={() => update(i, { removed: false })}
                    className="rounded-full border border-dashed border-border px-2 py-0.5 hover:border-border-strong"
                  >
                    + {item.query}
                  </button>
                ))}
            </div>
          )}
        </div>

        <aside id={`${id}-summary`} className="h-fit rounded-xl border border-border bg-surface p-3 text-sm">
          <div id={`${id}-summary-row`} className="flex justify-between">
            <span id={`${id}-summary-label`} className="text-text-secondary">
              Items
            </span>
            <span id={`${id}-subtotal`} data-testid="cart-subtotal" className="font-semibold">
              {money(subtotal)}
            </span>
          </div>
          {unpriced > 0 && (
            <p id={`${id}-unpriced`} className="mt-1 text-xs text-text-muted">
              Plus {unpriced} without a listed price
            </p>
          )}
          <a
            id={`${id}-handoff`}
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex w-full items-center justify-center rounded-full bg-charcoal px-4 py-2 text-sm font-medium text-on-charcoal hover:opacity-90"
          >
            Continue on {portal} ↗
          </a>
          <p id={`${id}-handoff-note`} className="mt-2 text-center text-[11px] leading-snug text-text-muted">
            Guest prices for your area. You sign in and check out on {portal}.
          </p>
        </aside>
      </div>
    </section>
  );
}
