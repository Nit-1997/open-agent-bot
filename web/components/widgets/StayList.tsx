"use client";

import type { StayList as StayListWidget } from "@shared/widgets";
import { Check, Star } from "lucide-react";
import { useState } from "react";
import { money } from "@/lib/format";
import { Favicon } from "@/components/chat/Favicon";
import { Picture } from "./CardRow";
import { widgetId } from "./widgetId";

type Source = StayListWidget["sources"][number];
type Stay = Source["stays"][number] & { source: string };

const ALL = "all";
const ALL_LIMIT = 12;

const STATUS_TEXT: Record<Source["status"], string> = {
  ok: "",
  link: "Search on",
  blocked: "Blocked us · open",
  failed: "Couldn't read · open",
};

function dateRange(checkin: string, checkout: string, locale: string): string {
  const fmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt.format(new Date(`${checkin}T00:00:00Z`))} – ${fmt.format(new Date(`${checkout}T00:00:00Z`))}`;
}

function ratingText(s: Stay): string | undefined {
  if (s.rating == null) return undefined;
  return s.ratingScale === 10 ? `${s.rating}/10` : `${s.rating}`;
}

function StayCard({
  id,
  stay,
  currency,
  locale,
  showSource,
  folded,
}: {
  id: string;
  stay: Stay;
  currency: string;
  locale: string;
  showSource: boolean;
  folded: boolean;
}) {
  const own = stay.currency ?? currency;
  const nightly = money(stay.nightly, own, locale);
  const total = money(stay.total, own, locale);
  const rating = ratingText(stay);
  const details = [stay.kind, stay.area].filter(Boolean).join(" · ");
  return (
    <li id={id} className={`min-w-0 snap-start sm:w-60 sm:shrink-0 ${folded ? "hidden sm:block" : ""}`}>
      <a
        id={`${id}-link`}
        href={stay.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-paper transition hover:border-border-strong hover:shadow-sm"
      >
        <span id={`${id}-media`} className="relative block aspect-[16/10] w-full overflow-hidden bg-surface">
          <Picture id={`${id}-img`} src={stay.image} alt={stay.title} fallback={stay.title} className="h-full w-full object-cover" />
          {stay.badge && (
            <span
              id={`${id}-badge`}
              className="absolute left-2 top-2 rounded-full bg-charcoal px-2 py-0.5 text-[11px] sm:text-[10px] font-semibold text-on-charcoal"
            >
              {stay.badge}
            </span>
          )}
        </span>
        <span id={`${id}-text`} className="flex flex-1 flex-col gap-0.5 px-3 pt-2">
          <span id={`${id}-title`} className="line-clamp-2 text-[13px] font-medium leading-snug text-text-primary">
            {stay.title}
          </span>
          {details && (
            <span id={`${id}-details`} className="line-clamp-1 text-xs text-text-secondary">
              {details}
            </span>
          )}
          {stay.met && stay.met.length > 0 && (
            <span id={`${id}-wishes`} className="mt-1 flex flex-wrap gap-1">
              {stay.met.map((m, i) => (
                <span
                  id={`${id}-wish-${i}`}
                  key={m}
                  className="inline-flex items-center gap-0.5 rounded-full bg-surface px-1.5 py-0.5 text-[11px] font-medium text-text-secondary"
                >
                  <Check id={`${id}-wish-${i}-check`} aria-hidden="true" size={10} />
                  {m}
                </span>
              ))}
            </span>
          )}
        </span>
        <span id={`${id}-foot`} className="mt-auto flex items-end justify-between gap-2 px-3 pb-2.5 pt-2">
          <span id={`${id}-prices`} className="flex flex-col">
            {nightly ? (
              <span id={`${id}-nightly`} className="text-sm font-semibold text-text-primary">
                {nightly}
                <span id={`${id}-per-night`} className="text-[12px] sm:text-[11px] font-normal text-text-muted">
                  {" "}
                  / night
                </span>
              </span>
            ) : (
              <span id={`${id}-no-price`} className="text-xs text-text-muted">
                Price not shown
              </span>
            )}
            {total && (
              <span id={`${id}-total`} className="text-[12px] sm:text-[11px] text-text-muted">
                {total} total
              </span>
            )}
          </span>
          <span id={`${id}-meta`} className="flex flex-col items-end gap-0.5 text-[12px] sm:text-[11px] text-text-muted">
            {rating && (
              <span id={`${id}-rating`} className="inline-flex items-center gap-0.5 font-medium text-text-secondary">
                <Star id={`${id}-star`} aria-hidden="true" size={11} className="fill-current" />
                {rating}
                {stay.reviews ? (
                  <span id={`${id}-reviews`} className="font-normal text-text-muted">{` (${stay.reviews.toLocaleString(locale)})`}</span>
                ) : null}
              </span>
            )}
            {showSource && <span id={`${id}-source`}>{stay.source}</span>}
          </span>
        </span>
      </a>
    </li>
  );
}

const NARROW_SHOWN = 4;

export function StayList({
  toolCallId,
  idPrefix,
  widget,
  locale = "en-US",
}: {
  toolCallId: string;
  idPrefix?: string;
  widget: StayListWidget;
  locale?: string;
}) {
  const id = widgetId("stays", toolCallId, idPrefix);
  const read = widget.sources.filter((s) => s.status === "ok" && s.stays.length);
  const others = widget.sources.filter((s) => !(s.status === "ok" && s.stays.length));
  const [tab, setTab] = useState(read.length > 1 ? ALL : (read[0]?.id ?? ALL));
  const [unfolded, setUnfolded] = useState(false);

  const tagged = (s: Source): Stay[] => s.stays.map((x) => ({ ...x, source: s.label }));
  const all = read
    .flatMap(tagged)
    .sort((a, b) => (b.met?.length ?? 0) - (a.met?.length ?? 0) || (a.nightly ?? Infinity) - (b.nightly ?? Infinity))
    .slice(0, ALL_LIMIT);
  const shown = tab === ALL ? all : tagged(read.find((s) => s.id === tab) ?? read[0] ?? widget.sources[0]);
  const guests = `${widget.adults} ${widget.adults === 1 ? "guest" : "guests"}`;
  const nights = `${widget.nights} ${widget.nights === 1 ? "night" : "nights"}`;
  const budget = widget.maxNightly != null ? ` · up to ${money(widget.maxNightly, widget.currency, locale)}/night` : "";
  const tabs = [...(read.length > 1 ? [{ id: ALL, label: "All · lowest price" }] : []), ...read.map((s) => ({ id: s.id, label: s.label }))];

  return (
    <section id={id} className="my-2 w-full rounded-2xl border border-border bg-paper p-3 sm:p-4">
      <header id={`${id}-header`}>
        <h3 id={`${id}-title`} className="text-base font-semibold text-text-primary">
          Stays in {widget.location}
        </h3>
        <p id={`${id}-subtitle`} className="text-xs text-text-muted">
          {`${dateRange(widget.checkin, widget.checkout, locale)} · ${nights} · ${guests}${budget}`}
        </p>
      </header>

      {tabs.length > 0 && (
        <div id={`${id}-tabs`} role="tablist" aria-label="Sites" className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {tabs.map((t) => (
            <button
              id={`${id}-tab-${t.id}`}
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-[13px] transition ${tab === t.id ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-paper text-text-secondary hover:border-border-strong"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {shown.length > 0 ? (
        <ul id={`${id}-list`} className="mt-3 grid grid-cols-2 gap-3 pb-2 sm:-mx-1 sm:flex sm:snap-x sm:overflow-x-auto sm:px-1">
          {shown.map((s, i) => (
            <StayCard
              key={`${tab}-${i}`}
              id={`${id}-${tab}-${i}`}
              stay={s}
              currency={widget.currency}
              locale={locale}
              showSource={tab === ALL}
              folded={!unfolded && i >= NARROW_SHOWN}
            />
          ))}
        </ul>
      ) : (
        <p id={`${id}-empty`} className="mt-3 text-sm text-text-muted">
          {widget.maxNightly != null
            ? "Nothing came back under that budget. Try the sites below."
            : "No listings could be read. Try the sites below."}
        </p>
      )}

      {!unfolded && shown.length > NARROW_SHOWN && (
        <button
          id={`${id}-more`}
          type="button"
          onClick={() => setUnfolded(true)}
          className="w-full rounded-xl border border-border bg-paper py-2 text-[14px] text-text-secondary hover:border-border-strong sm:hidden"
        >
          {`Show ${shown.length - NARROW_SHOWN} more`}
        </button>
      )}

      {others.length > 0 && (
        <footer id={`${id}-others`} className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-text-muted">
          {others.map((s) => (
            <a
              id={`${id}-other-${s.id}`}
              key={s.id}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-text-secondary transition hover:border-border-strong hover:text-text-primary"
            >
              <Favicon id={`${id}-other-${s.id}-icon`} host={s.site} size={14} className="ring-0" />
              {`${s.status === "ok" ? "Search on" : STATUS_TEXT[s.status]} ${s.label} ↗`}
            </a>
          ))}
        </footer>
      )}
    </section>
  );
}
