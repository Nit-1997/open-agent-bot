import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BrowseAction } from "./browsePolicy.js";
import { fail, ok, type ToolResult } from "./result.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EURO = new Set(["DE", "FR", "ES", "IT", "NL", "IE", "PT", "BE", "AT", "FI", "GR"]);
const CURRENCY: Record<string, string> = {
  IN: "INR", US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", SG: "SGD", AE: "AED", JP: "JPY", NZ: "NZD", CH: "CHF",
};

export function currencyForLocale(locale: string): string {
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  if (!region) return "USD";
  if (EURO.has(region)) return "EUR";
  return CURRENCY[region] ?? "USD";
}

type Query = { from: string; to: string; date: string; returnDate?: string; adults?: number };

export function googleFlightsUrl(q: Query, locale: string): string {
  const parts = [`Flights from ${q.from} to ${q.to} on ${q.date}`];
  parts.push(q.returnDate ? `returning ${q.returnDate}` : "one way");
  if (q.adults && q.adults > 1) parts.push(`for ${q.adults} adults`);
  const u = new URL("https://www.google.com/travel/flights");
  u.searchParams.set("q", parts.join(" "));
  u.searchParams.set("hl", locale);
  u.searchParams.set("curr", currencyForLocale(locale));
  return u.href;
}

export function flightsTool(deps: { locale: string; browse: (actions: BrowseAction[]) => Promise<ToolResult> }) {
  return defineTool({
    name: "flights",
    label: "Flights",
    description:
      "Search flight options on Google Flights. Returns the page text plus searchUrl. Extract real options into a flight_list widget and always give the user searchUrl to book themselves. Dates are YYYY-MM-DD; from/to are cities or IATA codes.",
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
      const searchUrl = googleFlightsUrl(params, deps.locale);
      const r = await deps.browse([{ op: "goto", url: searchUrl }, { op: "wait", ms: 3000 }, { op: "read" }]);
      const text = r.content.map((c) => c.text).join("");
      return { ...r, content: [{ type: "text", text: `searchUrl: ${searchUrl}\n\n${text}` }], details: { ...r.details, searchUrl } };
    },
  });
}
