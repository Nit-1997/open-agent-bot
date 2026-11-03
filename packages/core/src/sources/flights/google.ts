import type { BrowseAction } from "../../browser/policy.js";
import type { FlightOption } from "../../render/data.js";
import type { ToolResult } from "../../tools/result.js";
import type { Source } from "../types.js";

function layover(line: string | undefined): Pick<FlightOption, "layoverMinutes" | "layoverAt"> {
  const m = /^\s*(?:(\d+)\s*hrs?)?\s*(?:(\d+)\s*mins?)?\s+([A-Z]{3}(?:,\s*[A-Z]{3})*)\s*$/.exec(line ?? "");
  if (!m) return {};
  const minutes = m[1] || m[2] ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : undefined;
  return { ...(minutes != null && { layoverMinutes: minutes }), layoverAt: m[3] };
}

const TIME = String.raw`(\d{1,2}:\d{2}(?:\s?[ap]\.?m\.?)?(?:\+\d)?)`;
const OPTION = new RegExp(
  String.raw`${TIME}\s+[–-]\s+${TIME}\n([^\n]+)\n\s*\n(\d+ hrs?(?: \d+ mins?)?|\d+ mins?)\n\s*\n(Nonstop|\d+ stops?)\n[\s\S]{0,200}?\n[^\d\s]{1,4}\s?([\d,]+)\n`,
  "gi",
);

export type FlightQuery = { from: string; to: string; date: string; returnDate?: string; adults?: number };

export function googleFlightsUrl(q: FlightQuery, locale: string, currency: string): string {
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
    const after = lines[lines.indexOf(stopsText) + 1];
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

export type Browse = (actions: BrowseAction[], opts?: { fresh?: boolean; live?: boolean }) => Promise<ToolResult>;

export type FlightCtx = { locale: string; currency: string; browse: Browse; fresh: boolean; live: boolean };

export type FlightAttempt = { url: string; result: ToolResult; text: string; options: FlightOption[]; hardFail: boolean };

export type FlightSource = Source<FlightQuery, FlightAttempt, FlightCtx> & { label: string };

export const googleFlights: FlightSource = {
  id: "google_flights",
  label: "Google Flights",
  vertical: "flights",
  regions: ["*"],
  capabilities: ["search"],
  async search(q, ctx) {
    const url = googleFlightsUrl(q, ctx.locale, ctx.currency);
    const attempt = async (): Promise<FlightAttempt> => {
      const result = await ctx.browse([{ op: "goto", url }, { op: "wait", ms: 3000 }, { op: "read" }], {
        fresh: ctx.fresh,
        live: ctx.live,
      });
      const text = result.content.map((c) => c.text).join("");
      const hardFail = !!(result.isError || result.details?.blocked || result.details?.stopped);
      return { url, result, text, options: hardFail ? [] : parseGoogleFlights(text), hardFail };
    };
    let last = await attempt();
    if (!last.options.length) last = await attempt();
    return last;
  },
};
