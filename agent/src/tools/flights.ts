import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  type FlightPrefs,
  LAYOVER_OPTIONS,
  type LayoverPref,
  matchesPrefs,
  type RankedAirport,
  rankAirports,
  rideOneWay,
  TIME_OPTIONS,
  type TimeBucket,
} from "@oab/shared/flights";
import type { AirportResult, FlightOption, FlightsData } from "../render/data.js";
import { registry } from "../sources/index.js";
import { type Browse, type FlightSource, googleFlightsUrl, parseGoogleFlights, priceBasis } from "../sources/flights/google.js";
import { AIRPORTS, type Drive } from "./geo.js";
import { fail, ok, type ToolResult } from "./result.js";

export { googleFlightsUrl, parseGoogleFlights, priceBasis };

const MAX_ORIGINS = 4;
const NEARBY = /^(home|nearby)$/i;
const LAYOVER_IDS = LAYOVER_OPTIONS.map((o) => o.id);
const TIME_IDS = TIME_OPTIONS.map((o) => o.id);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function summary(o: FlightOption, currency: string): string {
  const stops =
    o.stops === 0
      ? "nonstop"
      : `${o.stops} stop${o.stops > 1 ? "s" : ""}${o.layoverAt ? ` (${o.layoverMinutes != null ? `${Math.floor(o.layoverMinutes / 60)}h ${o.layoverMinutes % 60}m ` : ""}in ${o.layoverAt})` : ""}`;
  return `${o.origin ? `${o.origin}: ` : ""}${o.airline} ${o.departTime} – ${o.arriveTime}, ${o.duration}, ${stops}${o.price != null ? `, ${o.price} ${currency}` : ""}`;
}

type Attempt = Awaited<ReturnType<FlightSource["search"]>>;
type Search = { code: string; url: string; last: Attempt };
type Deps = {
  source: FlightSource;
  locale: string;
  currency: string;
  browse: Browse;
  drive?: (airportCode: string) => Promise<Drive | null>;
  nearby?: () => Promise<string[]>;
};
type Params = { from: string; to: string; date: string; returnDate?: string; adults?: number; max_layover?: string; depart_times?: string };

function readPrefs(params: Params): FlightPrefs {
  const times = (params.depart_times ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is TimeBucket => (TIME_IDS as string[]).includes(t));
  return {
    ...(params.max_layover && params.max_layover !== "any" && { maxLayover: params.max_layover as LayoverPref }),
    ...(times.length && { times }),
  };
}

async function searchOrigin(deps: Deps, params: Params, code: string, opts: { fresh: boolean; live: boolean }): Promise<Search> {
  const last = await deps.source.search(
    { ...params, from: code },
    { locale: deps.locale, currency: deps.currency, browse: deps.browse, ...opts },
  );
  return { code, url: last.url, last };
}

async function airportResults(deps: Deps, searches: Search[], withRides: boolean): Promise<AirportResult[]> {
  return Promise.all(
    searches.map(async ({ code, url, last }): Promise<AirportResult> => {
      const known = AIRPORTS[code.toUpperCase()];
      const drive = withRides && deps.drive ? await deps.drive(code.toUpperCase()).catch(() => null) : null;
      return {
        code,
        ...(known && { name: known.name }),
        ...(drive && {
          miles: drive.miles,
          ...(drive.minutes != null && { driveMinutes: drive.minutes }),
          rideOneWay: rideOneWay(drive.miles),
        }),
        status: last.options.length ? "ok" : "failed",
        searchUrl: url,
      };
    }),
  );
}

function airportLine(a: RankedAirport<AirportResult>, money: (n: number) => string): string {
  if (a.status === "failed") return `- ${a.code}: couldn't load (the card links to Google Flights for it)`;
  const ride =
    a.rideOneWay != null
      ? `${a.driveMinutes != null ? `${a.driveMinutes} min drive` : `${a.miles} mi`}, ride about ${money(a.rideOneWay)} each way (estimate), `
      : "";
  const fare =
    a.bestFare != null
      ? `best matching fare ${money(a.bestFare)}${a.rideOneWay != null ? `, about ${money(a.total!)} all-in` : ""}`
      : "no flights match the preferences";
  const flags = [a.bestValue && "best value", a.closest && "closest"].filter(Boolean).join(", ");
  return `- ${a.code}${a.name ? ` ${a.name}` : ""}: ${ride}${fare}${flags ? ` (${flags})` : ""}`;
}

function prefsText(prefs: FlightPrefs): string[] {
  return [
    prefs.maxLayover && `layovers ${LAYOVER_OPTIONS.find((o) => o.id === prefs.maxLayover)!.label.toLowerCase()}`,
    prefs.times &&
      `departs ${prefs.times
        .map((t) => {
          const o = TIME_OPTIONS.find((x) => x.id === t)!;
          return `${o.label.toLowerCase()} ${o.hint}`;
        })
        .join(" or ")}`,
  ].filter((x): x is string => !!x);
}

function optionLines(options: FlightOption[], prefs: FlightPrefs, line: (o: FlightOption) => string): string[] {
  const wanted = prefsText(prefs);
  if (!wanted.length) return ["Options found:", ...options.slice(0, 10).map(line)];
  const matching = options.filter((o) => matchesPrefs(o, prefs));
  const others = options.filter((o) => !matchesPrefs(o, prefs));
  return [
    `Matching the preferences (${wanted.join("; ")}):`,
    ...(matching.length ? matching.slice(0, 10).map(line) : ["- none"]),
    ...(others.length ? ["Other options (outside the preferences):", ...others.slice(0, 5).map(line)] : []),
  ];
}

function modelText(data: FlightsData, ranked: RankedAirport<AirportResult>[], searches: Search[], multi: boolean): string {
  const money = (n: number) => `${n} ${data.currency}`;
  const line = (o: FlightOption) => `- ${summary(multi ? o : { ...o, origin: undefined }, data.currency)}`;
  return [
    `searchUrl: ${data.searchUrl}`,
    "",
    `(Note for you, do not repeat to the user: ${multi ? "one flight card comparing these airports, with filters the user can change," : "a flight card with these options and the booking link"} is already displayed.)`,
    ...(data.priceNote ? [`Prices: ${data.priceNote}.`] : []),
    ...(multi
      ? ["Airports, ranked by the best fare matching the preferences plus a round-trip ride:", ...ranked.map((a) => airportLine(a, money))]
      : []),
    ...(data.options.length
      ? optionLines(data.options, data.prefs, line)
      : ["No options could be read from the page.", "Page text:", searches[0].last.text]),
  ].join("\n");
}

export function flightsTool(args: Omit<Deps, "source"> & { source?: FlightSource }) {
  const source = args.source ?? registry.select<FlightSource>({ vertical: "flights", capability: "search" })[0];
  const deps: Deps = { ...args, source };
  return defineTool({
    name: "flights",
    label: "Flights",
    description:
      "Search flights and show one flight card with links for the user to book themselves. Dates are YYYY-MM-DD. from is an airport code or city, up to 4 codes separated by commas, or \"nearby\" for every airport near the user's home: use nearby when they fly from home, unless they chose the closest only. The card ranks airports by fare plus an estimated rideshare. Pass layover and departure-time preferences when known. Then explain the best value in a sentence and point to the search link; don't ask which airport or offer driving.",
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
      const asked = params.from
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      const wantsNearby = asked.some((o) => NEARBY.test(o));
      const nearby = wantsNearby ? await (deps.nearby?.() ?? Promise.resolve([])) : [];
      if (wantsNearby && !nearby.length && asked.every((o) => NEARBY.test(o))) {
        return fail("The user's home location is unknown, so there are no nearby airports to search. Ask them which airport to fly from.");
      }
      const origins = [...new Set(asked.flatMap((o) => (NEARBY.test(o) ? nearby : [o])))].slice(0, MAX_ORIGINS);
      if (!origins.length) return fail("from is empty");
      const prefs = readPrefs(params);
      const multi = origins.length > 1;

      const searches = await Promise.all(origins.map((code, i) => searchOrigin(deps, params, code, { fresh: multi, live: i === 0 })));

      if (searches.every((s) => s.last.hardFail)) {
        const links = searches.map((s) => `searchUrl: ${s.url}`).join("\n");
        const first = searches[0].last;
        return { ...first.result, content: [{ type: "text", text: `${links}\n\n${first.text}` }], details: { searchUrl: searches[0].url } };
      }

      const airports = await airportResults(deps, searches, multi && deps.currency === "USD");
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
        source: source.label,
      };
      return ok(modelText(data, ranked, searches, multi), { data });
    },
  });
}
