import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BrowseAction } from "./browsePolicy.js";
import {
  type FlightPrefs,
  LAYOVER_OPTIONS,
  type LayoverPref,
  matchesPrefs,
  rankAirports,
  rideOneWay,
  TIME_OPTIONS,
  type TimeBucket,
} from "../../../shared/flights.js";
import type { AirportResult, FlightOption, FlightsData } from "./data.js";
import { AIRPORTS, type Drive } from "./geo.js";
import { fail, ok, type ToolResult } from "./result.js";

export type { AirportResult };

const MAX_ORIGINS = 4;
const LAYOVER_IDS = LAYOVER_OPTIONS.map((o) => o.id);
const TIME_IDS = TIME_OPTIONS.map((o) => o.id);

function layover(line: string | undefined): Pick<FlightOption, "layoverMinutes" | "layoverAt"> {
  const m = /^\s*(?:(\d+)\s*hrs?)?\s*(?:(\d+)\s*mins?)?\s+([A-Z]{3}(?:,\s*[A-Z]{3})*)\s*$/.exec(line ?? "");
  if (!m) return {};
  const minutes = m[1] || m[2] ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : undefined;
  return { ...(minutes != null && { layoverMinutes: minutes }), layoverAt: m[3] };
}

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
    const stops = /nonstop/i.test(stopsText) ? 0 : Number.parseInt(stopsText, 10);
    const lines = m[0].split("\n");
    const after = lines[lines.findIndex((l) => l === stopsText) + 1];
    out.push({
      airline: airline.replace(/Operated by.*$/i, "").trim(),
      departTime,
      arriveTime,
      duration,
      stops,
      ...(stops > 0 ? layover(after) : {}),
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

function summary(o: FlightOption, currency: string): string {
  const stops =
    o.stops === 0
      ? "nonstop"
      : `${o.stops} stop${o.stops > 1 ? "s" : ""}${o.layoverAt ? ` (${o.layoverMinutes != null ? `${Math.floor(o.layoverMinutes / 60)}h ${o.layoverMinutes % 60}m ` : ""}in ${o.layoverAt})` : ""}`;
  return `${o.origin ? `${o.origin}: ` : ""}${o.airline} ${o.departTime} – ${o.arriveTime}, ${o.duration}, ${stops}${o.price != null ? `, ${o.price} ${currency}` : ""}`;
}

type Attempt = { result: ToolResult; text: string; options: FlightOption[]; hardFail: boolean };

export function flightsTool(deps: {
  locale: string;
  currency: string;
  browse: (actions: BrowseAction[]) => Promise<ToolResult>;
  drive?: (airportCode: string) => Promise<Drive | null>;
}) {
  return defineTool({
    name: "flights",
    label: "Flights",
    description: `Search flights on Google Flights and show one flight card (with links for the user to book themselves); afterwards summarize briefly. Dates are YYYY-MM-DD. 'from' is one airport code or city, or up to ${MAX_ORIGINS} nearby airport codes separated by commas (e.g. "SJC, SFO, OAK") to compare them in one search; the card ranks airports by fare plus an estimated rideshare from the user's home. Pass the user's layover and departure-time preferences when known.`,
    parameters: Type.Object({
      from: Type.String({ minLength: 2, description: "airport code or city, or comma-separated nearby airport codes" }),
      to: Type.String({ minLength: 2 }),
      date: Type.String({ description: "YYYY-MM-DD" }),
      returnDate: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      adults: Type.Optional(Type.Number()),
      max_layover: Type.Optional(Type.Enum(LAYOVER_IDS, { description: "longest layover the user accepts" })),
      depart_times: Type.Optional(Type.String({ description: `comma-separated parts of the day: ${TIME_IDS.join(", ")}` })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (!DATE.test(params.date) || (params.returnDate && !DATE.test(params.returnDate))) {
        return fail("dates must be YYYY-MM-DD");
      }
      const origins = [...new Set(params.from.split(",").map((o) => o.trim()).filter(Boolean))].slice(0, MAX_ORIGINS);
      if (!origins.length) return fail("from is empty");
      const times = (params.depart_times ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is TimeBucket => (TIME_IDS as string[]).includes(t));
      const prefs: FlightPrefs = {
        ...(params.max_layover && params.max_layover !== "any" && { maxLayover: params.max_layover as LayoverPref }),
        ...(times.length && { times }),
      };

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
      const withRides = multi && deps.currency === "USD" && deps.drive;
      const airports = await Promise.all(
        searches.map(async ({ code, url, last }): Promise<AirportResult> => {
          const known = AIRPORTS[code.toUpperCase()];
          const drive = withRides ? await deps.drive!(code.toUpperCase()).catch(() => null) : null;
          return {
            code,
            ...(known && { name: known.name }),
            ...(drive && { miles: drive.miles, ...(drive.minutes != null && { driveMinutes: drive.minutes }), rideOneWay: rideOneWay(drive.miles) }),
            status: last.options.length ? "ok" : "failed",
            searchUrl: url,
          };
        }),
      );
      const tagged = searches.flatMap((s) => s.last.options.map((o) => ({ ...o, origin: s.code })));
      const options = multi ? [...tagged].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)) : tagged;
      const ranked = rankAirports(airports, options, prefs);
      const best = ranked.find((a) => a.bestValue) ?? ranked[0];
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
        prefs,
        ...(basis && { priceNote: basis }),
        searchUrl: best.searchUrl,
        source: "Google Flights",
      };

      const money = (n: number) => `${n} ${deps.currency}`;
      const airportLines = ranked.map((a) => {
        if (a.status === "failed") return `- ${a.code}: couldn't load (the card links to Google Flights for it)`;
        const ride =
          a.rideOneWay != null
            ? `${a.driveMinutes != null ? `${a.driveMinutes} min drive` : `${a.miles} mi`}, ride about ${money(a.rideOneWay)} each way (estimate), `
            : "";
        const fare = a.bestFare != null ? `best matching fare ${money(a.bestFare)}${a.rideOneWay != null ? `, about ${money(a.total!)} all-in` : ""}` : "no flights match the preferences";
        const flags = [a.bestValue && "best value", a.closest && "closest"].filter(Boolean).join(", ");
        return `- ${a.code}${a.name ? ` ${a.name}` : ""}: ${ride}${fare}${flags ? ` (${flags})` : ""}`;
      });
      const prefText = [
        prefs.maxLayover && `layovers ${LAYOVER_OPTIONS.find((o) => o.id === prefs.maxLayover)!.label.toLowerCase()}`,
        prefs.times &&
          `departs ${prefs.times
            .map((t) => {
              const o = TIME_OPTIONS.find((x) => x.id === t)!;
              return `${o.label.toLowerCase()} ${o.hint}`;
            })
            .join(" or ")}`,
      ].filter(Boolean);
      const line = (o: FlightOption) => `- ${summary(multi ? o : { ...o, origin: undefined }, deps.currency)}`;
      const matching = options.filter((o) => matchesPrefs(o, prefs));
      const others = options.filter((o) => !matchesPrefs(o, prefs));
      const optionLines = prefText.length
        ? [
            `Matching the preferences (${prefText.join("; ")}):`,
            ...(matching.length ? matching.slice(0, 10).map(line) : ["- none"]),
            ...(others.length ? ["Other options (outside the preferences):", ...others.slice(0, 5).map(line)] : []),
          ]
        : ["Options found:", ...options.slice(0, 10).map(line)];
      const lines = [
        `searchUrl: ${data.searchUrl}`,
        "",
        `(Note for you, do not repeat to the user: ${multi ? "one flight card comparing these airports, with filters the user can change," : "a flight card with these options and the booking link"} is already displayed.)`,
        ...(basis ? [`Prices: ${basis}.`] : []),
        ...(multi ? ["Airports, ranked by the best fare matching the preferences plus a round-trip ride:", ...airportLines] : []),
        ...(options.length ? optionLines : ["No options could be read from the page.", "Page text:", searches[0].last.text]),
      ];
      return ok(lines.join("\n"), { data });
    },
  });
}
