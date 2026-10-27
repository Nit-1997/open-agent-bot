import type { FlightList as FlightListData } from "@shared/widgets";
import { money } from "@/lib/format";
import { ExternalLink } from "./Card";

function stopsLabel(stops: number) {
  return stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}`;
}

function prettyDate(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function FlightList({ toolCallId, widget, locale }: { toolCallId: string; widget: FlightListData; locale: string }) {
  const id = `flight-list-${toolCallId}`;
  const prices = widget.flights.map((f) => f.price).filter((p): p is number => p != null);
  const cheapest = prices.length ? Math.min(...prices) : undefined;
  const cheapestIndex = widget.flights.findIndex((f) => f.price === cheapest);

  return (
    <section id={id} className="my-2 w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <header id={`${id}-header`} className="flex items-center justify-between gap-3 bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-3 text-white">
        <div id={`${id}-route`} className="min-w-0">
          <h3 id={`${id}-title`} className="truncate text-lg font-semibold">{`${widget.from} → ${widget.to}`}</h3>
          <p id={`${id}-subtitle`} className="text-xs text-sky-100">
            {`${prettyDate(widget.date)} · ${widget.flights.length} option${widget.flights.length === 1 ? "" : "s"} · ${widget.source}`}
          </p>
        </div>
        {cheapest != null && (
          <div id={`${id}-from`} className="shrink-0 text-right">
            <span id={`${id}-from-label`} className="block text-[10px] uppercase tracking-wide text-sky-100">
              from
            </span>
            <span id={`${id}-from-price`} className="block text-lg font-bold">
              {money(cheapest, widget.currency, locale)}
            </span>
          </div>
        )}
      </header>

      {widget.flights.length === 0 ? (
        <p id={`${id}-empty`} className="px-4 py-3 text-sm text-neutral-500">
          No flight options could be read from the page.
        </p>
      ) : (
        <ul id={`${id}-flights`} className="divide-y divide-neutral-100">
          {widget.flights.map((f, i) => {
            const fid = `${id}-flight-${i}`;
            return (
              <li id={fid} key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5">
                <div id={`${fid}-times`} className="flex items-baseline gap-2">
                  <span id={`${fid}-depart`} className="text-base font-semibold">
                    {f.departTime}
                  </span>
                  <span id={`${fid}-arrow`} aria-hidden="true" className="text-neutral-400">
                    →
                  </span>
                  <span id={`${fid}-arrive`} className="text-base font-semibold">
                    {f.arriveTime}
                  </span>
                </div>
                <span id={`${fid}-price`} className="row-span-2 text-right text-base font-bold">
                  {money(f.price, widget.currency, locale) ?? "—"}
                </span>
                <div id={`${fid}-meta`} className="flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                  <span id={`${fid}-airline`} className="font-medium text-neutral-700">
                    {f.airline}
                  </span>
                  <span id={`${fid}-meta-text`}>{`${f.duration} · ${stopsLabel(f.stops)}`}</span>
                  {i === cheapestIndex && (
                    <span id={`${fid}-cheapest`} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Cheapest
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer id={`${id}-footer`} className="flex items-center justify-between gap-2 border-t border-neutral-100 px-4 py-3">
        <span id={`${id}-note`} className="text-xs text-neutral-500">
          Prices per adult, incl. taxes
        </span>
        <ExternalLink
          id={`${id}-search-link`}
          href={widget.searchUrl}
          className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Search &amp; book yourself
        </ExternalLink>
      </footer>
    </section>
  );
}
