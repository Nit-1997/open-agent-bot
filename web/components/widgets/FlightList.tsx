import type { FlightList as FlightListData } from "@shared/widgets";
import { money } from "@/lib/format";
import { Card, ExternalLink } from "./Card";

export function FlightList({ toolCallId, widget, locale }: { toolCallId: string; widget: FlightListData; locale: string }) {
  const id = `flight-list-${toolCallId}`;
  return (
    <Card id={id} title={`${widget.from} → ${widget.to}`} subtitle={`${widget.date} · ${widget.source}`}>
      {widget.flights.length === 0 ? (
        <p id={`${id}-empty`} className="mt-2 text-sm text-neutral-500">
          No flight options could be read from the page.
        </p>
      ) : (
        <ul id={`${id}-flights`} className="mt-2 divide-y divide-neutral-200 dark:divide-neutral-800">
          {widget.flights.map((f, i) => (
            <li id={`${id}-flight-${i}`} key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span id={`${id}-flight-${i}-airline`} className="font-medium">
                {f.airline}
              </span>
              <span id={`${id}-flight-${i}-times`}>{`${f.departTime} – ${f.arriveTime}`}</span>
              <span id={`${id}-flight-${i}-meta`} className="text-neutral-500">
                {`${f.duration} · ${f.stops === 0 ? "nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""}`}`}
              </span>
              <span id={`${id}-flight-${i}-price`} className="font-semibold">
                {money(f.price, widget.currency, locale) ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ExternalLink
        id={`${id}-search-link`}
        href={widget.searchUrl}
        className="mt-3 inline-block rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Search &amp; book yourself
      </ExternalLink>
    </Card>
  );
}
