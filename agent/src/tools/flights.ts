import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BrowseAction } from "./browsePolicy.js";
import type { FlightOption, FlightsData } from "./data.js";
import { fail, ok, type ToolResult } from "./result.js";

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

function summary(o: FlightOption, currency: string): string {
  const stops = o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`;
  return `${o.airline} ${o.departTime} – ${o.arriveTime}, ${o.duration}, ${stops}${o.price != null ? `, ${o.price} ${currency}` : ""}`;
}

export function flightsTool(deps: { locale: string; currency: string; browse: (actions: BrowseAction[]) => Promise<ToolResult> }) {
  return defineTool({
    name: "flights",
    label: "Flights",
    description:
      "Search flight options on Google Flights. The flight card (with a link for the user to book themselves) is shown to the user automatically; afterwards summarize the best options briefly. Dates are YYYY-MM-DD; from/to are cities or IATA codes.",
    parameters: Type.Object({
      from: Type.String({ minLength: 2 }),
      to: Type.String({ minLength: 2 }),
      date: Type.String({ description: "YYYY-MM-DD" }),
      returnDate: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      adults: Type.Optional(Type.Number()),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (!DATE.test(params.date) || (params.returnDate && !DATE.test(params.returnDate))) {
        return fail("dates must be YYYY-MM-DD");
      }
      const searchUrl = googleFlightsUrl(params, deps.locale, deps.currency);
      const r = await deps.browse([{ op: "goto", url: searchUrl }, { op: "wait", ms: 3000 }, { op: "read" }]);
      const pageText = r.content.map((c) => c.text).join("");
      if (r.isError || r.details?.blocked || r.details?.stopped) {
        return { ...r, content: [{ type: "text", text: `searchUrl: ${searchUrl}\n\n${pageText}` }], details: { searchUrl } };
      }
      const options = parseGoogleFlights(pageText);
      const data: FlightsData = {
        kind: "flights",
        from: params.from,
        to: params.to,
        date: params.date,
        currency: deps.currency,
        options,
        searchUrl,
        source: "Google Flights",
      };
      const body = options.length
        ? `(Note for you, do not repeat to the user: a flight card with these options and the booking link is already displayed.)\nOptions found:\n${options.slice(0, 8).map((o) => `- ${summary(o, deps.currency)}`).join("\n")}`
        : `(Note for you, do not repeat to the user: a flight card with the booking link is already displayed, but no options could be read from the page.)\nPage text:\n${pageText}`;
      return ok(`searchUrl: ${searchUrl}\n\n${body}`, { data });
    },
  });
}
