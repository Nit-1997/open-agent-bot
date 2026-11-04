"use client";

import { airlineHost } from "../../lib/airlines.ts";
import { Favicon } from "../chat/Favicon";
import {
  type FlightPrefs,
  LAYOVER_OPTIONS,
  type LayoverPref,
  matchesPrefs,
  rankAirports,
  TIME_OPTIONS,
  type TimeBucket,
} from "@oab/shared/flights";
import type { FlightList as FlightListData } from "@oab/shared/widgets";
import { useMemo, useState } from "react";
import { money } from "../../lib/format.ts";
import { ExternalLink } from "./ExternalLink";
import { widgetId } from "./widgetId";

const VISIBLE_FLIGHTS = 8;

function stopsLabel(f: { stops: number; layoverMinutes?: number; layoverAt?: string }) {
  if (f.stops === 0) return "Nonstop";
  const base = `${f.stops} stop${f.stops > 1 ? "s" : ""}`;
  if (!f.layoverAt) return base;
  const wait = f.layoverMinutes != null ? `${Math.floor(f.layoverMinutes / 60)}h ${f.layoverMinutes % 60}m ` : "";
  return `${base} · ${wait}in ${f.layoverAt}`;
}

function prettyDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function whole(value: number, currency: string, locale: string) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

function Filters({ id, prefs, onChange }: { id: string; prefs: FlightPrefs; onChange: (p: FlightPrefs) => void }) {
  const layover = prefs.maxLayover ?? "any";
  const times = prefs.times ?? [];
  const chip = (on: boolean) =>
    `cursor-pointer rounded-full border px-2.5 py-1 text-[12px] transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-mist-500 ${
      on ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-paper text-text-secondary hover:border-border-strong"
    }`;
  return (
    <div id={id} className="space-y-2 border-b border-border px-4 py-3">
      <div id={`${id}-layover`} role="radiogroup" aria-label="Layovers" className="flex flex-wrap items-center gap-1.5">
        <span id={`${id}-layover-label`} className="eyebrow mr-1">
          Layovers
        </span>
        {LAYOVER_OPTIONS.map((o) => (
          <label id={`${id}-layover-${o.id}`} key={o.id} className={chip(layover === o.id)}>
            <input
              id={`${id}-layover-${o.id}-input`}
              type="radio"
              name={`${id}-layover`}
              checked={layover === o.id}
              onChange={() => onChange({ ...prefs, maxLayover: o.id as LayoverPref })}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      <div id={`${id}-times`} role="group" aria-label="Departure time" className="flex flex-wrap items-center gap-1.5">
        <span id={`${id}-times-label`} className="eyebrow mr-1">
          Departs
        </span>
        {TIME_OPTIONS.map((o) => {
          const on = times.includes(o.id);
          return (
            <label id={`${id}-time-${o.id}`} key={o.id} title={o.hint} className={chip(on)}>
              <input
                id={`${id}-time-${o.id}-input`}
                type="checkbox"
                checked={on}
                onChange={() => onChange({ ...prefs, times: on ? times.filter((t) => t !== o.id) : [...times, o.id as TimeBucket] })}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Badge({ id, tone, children }: { id: string; tone: "agent" | "good" | "plain"; children: React.ReactNode }) {
  const cls =
    tone === "agent"
      ? "bg-charcoal text-on-charcoal"
      : tone === "good"
        ? "bg-success-bg text-success-fg"
        : "bg-surface-accent text-text-secondary";
  return (
    <span id={id} className={`rounded-full px-2 py-0.5 text-[11px] sm:text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

export function FlightList({
  toolCallId,
  idPrefix,
  widget,
  locale,
}: {
  toolCallId: string;
  idPrefix?: string;
  widget: FlightListData;
  locale: string;
}) {
  const id = widgetId("flight-list", toolCallId, idPrefix);
  const [prefs, setPrefs] = useState<FlightPrefs>(widget.prefs ?? {});
  const [showAll, setShowAll] = useState(false);
  const visible = useMemo(() => widget.flights.filter((f) => matchesPrefs(f, prefs)), [widget.flights, prefs]);
  const airports = useMemo(
    () => (widget.airports && widget.airports.length > 1 ? rankAirports(widget.airports, widget.flights, prefs) : undefined),
    [widget.airports, widget.flights, prefs],
  );
  const prices = visible.map((f) => f.price).filter((p): p is number => p != null);
  const cheapest = prices.length ? Math.min(...prices) : undefined;
  const cheapestIndex = visible.findIndex((f) => f.price === cheapest);
  const hasRides = airports?.some((a) => a.rideOneWay != null);
  const dates = `${prettyDate(widget.date)}${widget.returnDate ? ` → ${prettyDate(widget.returnDate)}` : ""}`;
  const shown = showAll ? visible : visible.slice(0, VISIBLE_FLIGHTS);
  const bookUrl = airports?.find((a) => a.bestValue)?.searchUrl ?? widget.searchUrl;

  return (
    <section id={id} className="w-full overflow-hidden rounded-2xl border border-border bg-paper">
      <header
        id={`${id}-header`}
        style={{ background: "var(--accent-gradient)" }}
        className="flex items-center justify-between gap-3 px-4 py-3.5 text-text-primary"
      >
        <div id={`${id}-route`} className="min-w-0">
          <h3 id={`${id}-title`} className="truncate text-lg font-semibold">{`${widget.from} → ${widget.to}`}</h3>
          <p id={`${id}-subtitle`} className="text-xs text-text-secondary">
            {`${dates} · ${visible.length} of ${widget.flights.length} option${widget.flights.length === 1 ? "" : "s"} · ${widget.source}`}
          </p>
        </div>
        {cheapest != null && (
          <div id={`${id}-from`} className="shrink-0 text-right">
            <span id={`${id}-from-label`} className="eyebrow block">
              from
            </span>
            <span id={`${id}-from-price`} className="block text-lg font-bold">
              {money(cheapest, widget.currency, locale)}
            </span>
          </div>
        )}
      </header>

      {widget.flights.length > 1 && <Filters id={`${id}-filters`} prefs={prefs} onChange={setPrefs} />}

      {airports && (
        <div id={`${id}-airports`} className="border-b border-border px-4 py-3">
          <p id={`${id}-airports-title`} className="eyebrow mb-2">
            Airports, by fare plus ride
          </p>
          <ul id={`${id}-airports-list`} className="space-y-1.5">
            {airports.map((a, i) => {
              const aid = `${id}-airport-${i}`;
              if (a.status === "failed") {
                return (
                  <li
                    id={aid}
                    key={a.code}
                    className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-text-muted"
                  >
                    <span id={`${aid}-code`} className="font-mono font-medium">
                      {a.code}
                    </span>
                    <ExternalLink id={`${aid}-link`} href={a.searchUrl} className="text-xs text-mist-600 underline underline-offset-2">
                      Couldn&apos;t load · open on Google Flights
                    </ExternalLink>
                  </li>
                );
              }
              return (
                <li
                  id={aid}
                  key={a.code}
                  className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${a.bestValue ? "bg-paper shadow-float ring-1 ring-charcoal/15" : "bg-surface"}`}
                >
                  <div id={`${aid}-main`} className="min-w-0">
                    <div id={`${aid}-head`} className="flex flex-wrap items-center gap-1.5">
                      <span id={`${aid}-code`} className="font-mono text-sm font-medium text-text-primary">
                        {a.code}
                      </span>
                      {a.name && (
                        <span id={`${aid}-name`} className="text-xs text-text-muted">
                          {a.name}
                        </span>
                      )}
                      {a.bestValue && (
                        <Badge id={`${aid}-best`} tone="agent">
                          Best value
                        </Badge>
                      )}
                      {a.closest && (
                        <Badge id={`${aid}-closest`} tone="plain">
                          Closest
                        </Badge>
                      )}
                    </div>
                    {a.rideOneWay != null && (
                      <p id={`${aid}-ride`} className="mt-0.5 text-xs text-text-muted">
                        {`~${whole(a.rideOneWay, widget.currency, locale)} each way · ${a.driveMinutes != null ? `${a.driveMinutes} min drive` : `${a.miles} mi`}`}
                      </p>
                    )}
                  </div>
                  <div id={`${aid}-prices`} className="shrink-0 text-right">
                    {a.bestFare != null ? (
                      <>
                        <span id={`${aid}-fare`} className="block text-sm font-semibold">
                          {whole(a.bestFare, widget.currency, locale)}
                        </span>
                        {a.rideOneWay != null && a.total != null && (
                          <span id={`${aid}-total`} className="block text-[12px] sm:text-[11px] text-text-muted">
                            {`${whole(a.total, widget.currency, locale)} all-in`}
                          </span>
                        )}
                      </>
                    ) : (
                      <span id={`${aid}-nomatch`} className="text-[12px] sm:text-[11px] text-text-muted">
                        No flights match these filters
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {widget.flights.length === 0 ? (
        <p id={`${id}-empty`} className="px-4 py-3 text-sm text-text-muted">
          No flight options could be read from the page.
        </p>
      ) : visible.length === 0 ? (
        <p id={`${id}-filtered-empty`} className="px-4 py-3 text-sm text-text-muted">
          No flights match these filters. Try a longer layover or another time of day.
        </p>
      ) : (
        <ul id={`${id}-flights`} className="divide-y divide-border">
          {shown.map((f, i) => {
            const fid = `${id}-flight-${i}`;
            return (
              <li id={fid} key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                <div id={`${fid}-times`} className="flex items-baseline gap-2">
                  {airports && f.origin && (
                    <span
                      id={`${fid}-origin`}
                      className="rounded-md bg-surface-accent px-1.5 py-0.5 font-mono text-[11px] sm:text-[10px] font-medium text-text-secondary"
                    >
                      {f.origin}
                    </span>
                  )}
                  <span id={`${fid}-depart`} className="text-base font-semibold">
                    {f.departTime}
                  </span>
                  <span id={`${fid}-arrow`} aria-hidden="true" className="text-text-faint">
                    →
                  </span>
                  <span id={`${fid}-arrive`} className="text-base font-semibold">
                    {f.arriveTime}
                  </span>
                </div>
                <span id={`${fid}-price`} className="row-span-2 text-right text-base font-bold">
                  {money(f.price, widget.currency, locale) ?? "—"}
                </span>
                <div id={`${fid}-meta`} className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                  <span id={`${fid}-airline`} className="inline-flex items-center gap-1.5 font-medium text-text-secondary">
                    {airlineHost(f.airline) && <Favicon id={`${fid}-logo`} host={airlineHost(f.airline)!} size={16} className="ring-0" />}
                    {f.airline}
                  </span>
                  <span id={`${fid}-duration`}>{f.duration}</span>
                  <span id={`${fid}-stops`}>{stopsLabel(f)}</span>
                  {i === cheapestIndex && (
                    <Badge id={`${fid}-cheapest`} tone="good">
                      Cheapest
                    </Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {visible.length > VISIBLE_FLIGHTS && (
        <button
          id={`${id}-show-all`}
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full border-t border-border px-4 py-2 text-[13px] text-text-secondary transition hover:bg-surface"
        >
          {showAll ? "Show fewer" : `Show all ${visible.length} flights`}
        </button>
      )}

      <footer id={`${id}-footer`} className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div id={`${id}-notes`} className="min-w-0 text-xs text-text-muted">
          <p id={`${id}-note`}>{widget.priceNote ?? "Prices as listed on Google Flights"}</p>
          {hasRides && <p id={`${id}-ride-note`}>Rides are estimates from your home by driving distance, there and back.</p>}
        </div>
        <ExternalLink
          id={`${id}-search-link`}
          href={bookUrl}
          className="shrink-0 rounded-full bg-charcoal px-4 py-1.5 text-sm font-medium text-on-charcoal hover:opacity-85"
        >
          Search &amp; book yourself
        </ExternalLink>
      </footer>
    </section>
  );
}
