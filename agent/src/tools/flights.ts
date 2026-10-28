import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BrowseAction } from "./browsePolicy.js";
import type { AirportResult, FlightOption, FlightsData } from "./data.js";
import { AIRPORTS, type LatLon, milesBetween, rideshareRoundTrip } from "./geo.js";
import { fail, ok, type ToolResult } from "./result.js";

export type { AirportResult };

export const SAVINGS_THRESHOLD = 30;
const MAX_ORIGINS = 4;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = String.raw`(\d{1,2}:\d{2}(?:\s?[ap]\.?m\.?)?(?:\+\d)?)`;
const OPTION = new RegExp(
  String.raw`${TIME}\s+[–-]\s+${TIME}\n([^\n]+)\n\s*\n(\d+ hrs?(?: \d+ mins?)?|\d+ mins?)\n\s*\n(Nonstop|\d+ stops?)\n[\s\S]{0,200}?\n[^\d\s]{1,4}\s?([\d,]+)\n`,
  "gi",
);

type Query = { from: string; to: string; date: string; returnDate?: string; adults?: number };

export function googleFlightsUrl(q: Query, locale: string, currency: string): string {
  const parts = [`Flights from ${q.from} to ${q.to} on ${q.date}`];
  parts.push(q.returnDate ? `returning ${q.returnDate}` : "one way");
  if (q.adults && q.adults > 1) parts.push(`for ${q.adults} adults`);
  const u = new URL("https://www.google.com/travel/flights");
  u.searchParams.set("q", parts.join(" "));
  u.searchParams.set("hl", locale);
  u.searchParams.set("curr", currency);
  return u.href;
}

export function parseGoogleFlights(text: string): FlightOption[] {
  const seen = new Set<string>();
  const out: FlightOption[] = [];
  for (const m of text.matchAll(OPTION)) {
    const [, departTime, arriveTime, airline, duration, stopsText, priceText] = m;
    const key = `${departTime}|${arriveTime}|${airline}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const price = Number(priceText.replace(/,/g, ""));
    out.push({
      airline: airline.replace(/Operated by.*$/i, "").trim(),
      departTime,
      arriveTime,
      duration,
      stops: /nonstop/i.test(stopsText) ? 0 : Number.parseInt(stopsText, 10),
      ...(Number.isFinite(price) ? { price } : {}),
    });
  }
  return out;
}

export function priceBasis(text: string, roundTrip: boolean): string | undefined {
  const m = /Prices include required taxes \+ fees for (\d+) (adults?)/i.exec(text);
  if (!m) return undefined;
  return `${roundTrip ? "Round-trip" : "One-way"} total for ${m[1]} ${m[2].toLowerCase()}, incl. taxes and fees`;
}

export function rankAirports(airports: AirportResult[], threshold = SAVINGS_THRESHOLD): AirportResult[] {
  const out = airports.map(({ closest: _c, cheapest: _ch, recommended: _r, total: _t, ...a }): AirportResult =>
    a.status === "ok" && a.bestFare != null ? { ...a, total: a.bestFare + (a.ground ?? 0) } : a,
  );
  const priced = out.filter((a) => a.total != null);
  if (!priced.length) return out;
  const cheapest = priced.reduce((m, a) => (a.total! < m.total! ? a : m));
  const near = priced.filter((a) => a.miles != null);
  const closest = near.length ? near.reduce((m, a) => (a.miles! < m.miles! ? a : m)) : undefined;
  const recommended = closest && closest.total! - cheapest.total! < threshold ? closest : cheapest;
  cheapest.cheapest = true;
  if (closest) closest.closest = true;
  recommended.recommended = true;
  return out;
}

function summary(o: FlightOption, currency: string): string {
  const stops = o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`;
  return `${o.origin ? `${o.origin}: ` : ""}${o.airline} ${o.departTime} – ${o.arriveTime}, ${o.duration}, ${stops}${o.price != null ? `, ${o.price} ${currency}` : ""}`;
}

type Attempt = { result: ToolResult; text: string; options: FlightOption[]; hardFail: boolean };

export function flightsTool(deps: {
  locale: string;
  currency: string;
  browse: (actions: BrowseAction[]) => Promise<ToolResult>;
  home?: () => Promise<LatLon | null>;
}) {
  return defineTool({
    name: "flights",
    label: "Flights",
    description: `Search flights on Google Flights and show one flight card (with links for the user to book themselves); afterwards summarize briefly. Dates are YYYY-MM-DD. 'from' is one airport code or city, or up to ${MAX_ORIGINS} nearby airport codes separated by commas (e.g. "SJC, SFO, OAK") to compare them in one search: the card ranks them by fare plus an estimated rideshare from the user's home and recommends the closest unless another saves at least $${SAVINGS_THRESHOLD}.`,
    parameters: Type.Object({
      from: Type.String({ minLength: 2, description: "airport code or city, or comma-separated nearby airport codes" }),
      to: Type.String({ minLength: 2 }),
      date: Type.String({ description: "YYYY-MM-DD" }),
      returnDate: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      adults: Type.Optional(Type.Number()),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (!DATE.test(params.date) || (params.returnDate && !DATE.test(params.returnDate))) {
        return fail("dates must be YYYY-MM-DD");
      }
      const origins = [...new Set(params.from.split(",").map((o) => o.trim()).filter(Boolean))].slice(0, MAX_ORIGINS);
      if (!origins.length) return fail("from is empty");
      const home = deps.currency === "USD" && deps.home ? await deps.home().catch(() => null) : null;

      const attempt = async (url: string): Promise<Attempt> => {
        const result = await deps.browse([{ op: "goto", url }, { op: "wait", ms: 3000 }, { op: "read" }]);
        const text = result.content.map((c) => c.text).join("");
        const hardFail = !!(result.isError || result.details?.blocked || result.details?.stopped);
        return { result, text, options: hardFail ? [] : parseGoogleFlights(text), hardFail };
      };

      const searches: Array<{ code: string; url: string; last: Attempt }> = [];
      for (const code of origins) {
        const url = googleFlightsUrl({ ...params, from: code }, deps.locale, deps.currency);
        let last = await attempt(url);
        if (!last.options.length) last = await attempt(url);
        searches.push({ code, url, last });
      }

      if (searches.every((s) => s.last.hardFail)) {
        const links = searches.map((s) => `searchUrl: ${s.url}`).join("\n");
        const first = searches[0].last;
        return { ...first.result, content: [{ type: "text", text: `${links}\n\n${first.text}` }], details: { searchUrl: searches[0].url } };
      }

      const multi = origins.length > 1;
      const airports = rankAirports(
        searches.map(({ code, url, last }): AirportResult => {
          const known = AIRPORTS[code.toUpperCase()];
          const miles = home && known ? Math.round(milesBetween(home, known)) : undefined;
          const prices = last.options.map((o) => o.price).filter((p): p is number => p != null);
          return {
            code,
            ...(known && { name: known.name }),
            ...(miles != null && { miles, ground: rideshareRoundTrip(miles) }),
            ...(prices.length && { bestFare: Math.min(...prices) }),
            options: last.options.length,
            searchUrl: url,
            status: last.options.length ? "ok" : "failed",
          };
        }),
      );
      const tagged = searches.flatMap((s) => s.last.options.map((o) => ({ ...o, origin: s.code })));
      const options = multi ? [...tagged].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)) : tagged;
      const best = airports.find((a) => a.recommended) ?? airports[0];
      const basis = searches.map((s) => priceBasis(s.last.text, !!params.returnDate)).find(Boolean);

      const data: FlightsData = {
        kind: "flights",
        from: origins.join(" · "),
        to: params.to,
        date: params.date,
        ...(params.returnDate && { returnDate: params.returnDate }),
        currency: deps.currency,
        options,
        airports,
        ...(basis && { priceNote: basis }),
        searchUrl: best.searchUrl,
        source: "Google Flights",
      };

      const money = (n: number) => `${n} ${deps.currency}`;
      const airportLines = airports.map((a) => {
        if (a.status === "failed") return `- ${a.code}: couldn't load (the card links to Google Flights for it)`;
        const ride = a.ground != null ? `${a.miles} mi away, ride about ${money(a.ground)} round trip (estimate), ` : "";
        const flags = [a.closest && "closest", a.cheapest && "cheapest all-in", a.recommended && "recommended"].filter(Boolean).join(", ");
        return `- ${a.code}${a.name ? ` ${a.name}` : ""}: ${ride}best fare ${money(a.bestFare!)}${a.ground != null ? `, about ${money(a.total!)} all-in` : ""}${flags ? ` (${flags})` : ""}`;
      });
      const lines = [
        `searchUrl: ${data.searchUrl}`,
        "",
        `(Note for you, do not repeat to the user: ${multi ? "one flight card comparing these airports" : "a flight card with these options and the booking link"} is already displayed.)`,
        ...(basis ? [`Prices: ${basis}.`] : []),
        ...(multi ? ["Airports:", ...airportLines] : []),
        ...(options.length
          ? ["Options found:", ...options.slice(0, 8).map((o) => `- ${summary(multi ? o : { ...o, origin: undefined }, deps.currency)}`)]
          : ["No options could be read from the page.", "Page text:", searches[0].last.text]),
      ];
      return ok(lines.join("\n"), { data });
    },
  });
}
