import type { FlightList as FlightListData } from "@shared/widgets";
import { money } from "@/lib/format";
import { ExternalLink } from "./Card";

type Airport = NonNullable<FlightListData["airports"]>[number];

function stopsLabel(stops: number) {
  return stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`;
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

function rank(airports: Airport[]): Airport[] {
  const score = (a: Airport) => (a.status === "failed" ? 2 : a.recommended ? 0 : 1);
  return [...airports].sort((a, b) => score(a) - score(b) || (a.total ?? Infinity) - (b.total ?? Infinity));
}

function Badge({ id, tone, children }: { id: string; tone: "agent" | "good" | "plain"; children: React.ReactNode }) {
  const cls = tone === "agent" ? "bg-cortex-100 text-cortex-600" : tone === "good" ? "bg-success-bg text-success-fg" : "bg-surface-accent text-text-secondary";
  return (
    <span id={id} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

export function FlightList({ toolCallId, widget, locale }: { toolCallId: string; widget: FlightListData; locale: string }) {
  const id = `flight-list-${toolCallId}`;
  const prices = widget.flights.map((f) => f.price).filter((p): p is number => p != null);
  const cheapest = prices.length ? Math.min(...prices) : undefined;
  const cheapestIndex = widget.flights.findIndex((f) => f.price === cheapest);
  const airports = widget.airports && widget.airports.length > 1 ? rank(widget.airports) : undefined;
  const hasRides = airports?.some((a) => a.ground != null);
  const dates = `${prettyDate(widget.date)}${widget.returnDate ? ` → ${prettyDate(widget.returnDate)}` : ""}`;

  return (
    <section id={id} className="w-full overflow-hidden rounded-2xl border border-border bg-paper">
      <header id={`${id}-header`} style={{ background: "var(--accent-gradient)" }} className="flex items-center justify-between gap-3 px-4 py-3.5 text-text-primary">
        <div id={`${id}-route`} className="min-w-0">
          <h3 id={`${id}-title`} className="truncate text-lg font-semibold">{`${widget.from} → ${widget.to}`}</h3>
          <p id={`${id}-subtitle`} className="text-xs text-text-secondary">
            {`${dates} · ${widget.flights.length} option${widget.flights.length === 1 ? "" : "s"} · ${widget.source}`}
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

      {airports && (
        <div id={`${id}-airports`} className="border-b border-border px-4 py-3">
          <p id={`${id}-airports-title`} className="eyebrow mb-2">
            Airports compared
          </p>
          <ul id={`${id}-airports-list`} className="space-y-1.5">
            {airports.map((a, i) => {
              const aid = `${id}-airport-${i}`;
              if (a.status === "failed") {
                return (
                  <li id={aid} key={a.code} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-text-muted">
                    <span id={`${aid}-code`} className="font-mono font-medium">
                      {a.code}
                    </span>
                    <ExternalLink id={`${aid}-link`} href={a.searchUrl} className="text-xs text-cortex-600 underline underline-offset-2">
                      Couldn&apos;t load · open on Google Flights
                    </ExternalLink>
                  </li>
                );
              }
              return (
                <li
                  id={aid}
                  key={a.code}
                  className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${a.recommended ? "bg-cortex-50 ring-1 ring-cortex-300" : "bg-surface"}`}
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
                      {a.recommended && (
                        <Badge id={`${aid}-recommended`} tone="agent">
                          Recommended
                        </Badge>
                      )}
                      {a.closest && (
                        <Badge id={`${aid}-closest`} tone="plain">
                          Closest
                        </Badge>
                      )}
                      {a.cheapest && (
                        <Badge id={`${aid}-cheapest`} tone="good">
                          Cheapest all-in
                        </Badge>
                      )}
                    </div>
                    {a.ground != null && (
                      <p id={`${aid}-ride`} className="mt-0.5 text-xs text-text-muted">
                        {`${a.miles} mi · ~${whole(a.ground, widget.currency, locale)} ride`}
                      </p>
                    )}
                  </div>
                  <div id={`${aid}-prices`} className="shrink-0 text-right">
                    {a.bestFare != null && (
                      <span id={`${aid}-fare`} className="block text-sm font-semibold">
                        {whole(a.bestFare, widget.currency, locale)}
                      </span>
                    )}
                    {a.ground != null && a.total != null && (
                      <span id={`${aid}-total`} className="block text-[11px] text-text-muted">
                        {`${whole(a.total, widget.currency, locale)} all-in`}
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
      ) : (
        <ul id={`${id}-flights`} className="divide-y divide-border">
          {widget.flights.map((f, i) => {
            const fid = `${id}-flight-${i}`;
            return (
              <li id={fid} key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                <div id={`${fid}-times`} className="flex items-baseline gap-2">
                  {airports && f.origin && (
                    <span id={`${fid}-origin`} className="rounded-md bg-surface-accent px-1.5 py-0.5 font-mono text-[10px] font-medium text-text-secondary">
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
                  <span id={`${fid}-airline`} className="font-medium text-text-secondary">
                    {f.airline}
                  </span>
                  <span id={`${fid}-meta-text`}>{`${f.duration} · ${stopsLabel(f.stops)}`}</span>
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

      <footer id={`${id}-footer`} className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div id={`${id}-notes`} className="min-w-0 text-xs text-text-muted">
          <p id={`${id}-note`}>{widget.priceNote ?? "Prices as listed on Google Flights"}</p>
          {hasRides && <p id={`${id}-ride-note`}>Rides are rough estimates from your home, there and back.</p>}
        </div>
        <ExternalLink
          id={`${id}-search-link`}
          href={widget.searchUrl}
          className="shrink-0 rounded-full bg-charcoal px-4 py-1.5 text-sm font-medium text-on-charcoal hover:opacity-85"
        >
          Search &amp; book yourself
        </ExternalLink>
      </footer>
    </section>
  );
}
