import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatMoney } from "../shop/currency.js";
import { type OpenTab, type SourceResult, searchStays } from "../stays/search.js";
import { STAY_SOURCES } from "../stays/sources/index.js";
import type { Stay, StayKind, StayQuery, StaySource } from "../stays/types.js";
import { looseList } from "./args.js";
import type { StaysData } from "./data.js";
import { fail, ok, type ToolResult } from "./result.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const MAX_NIGHTS = 30;
const SHOWN_PER_SOURCE = 5;

type Deps = { openTab: OpenTab; currency: string; sources?: StaySource[]; allowPrivateHosts?: boolean };

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function pickSources(all: StaySource[], ids: string[], type: StayKind | "any"): StaySource[] {
  const wanted = ids.map((i) => i.trim().toLowerCase().replace(/[\s.-]+/g, "_"));
  const named = wanted.length ? all.filter((s) => wanted.some((w) => s.id === w || s.id.startsWith(w) || s.site.startsWith(w.replace(/_/g, ".")))) : [];
  const pool = named.length ? named : all;
  return type === "any" ? pool : pool.filter((s) => s.lists.includes(type));
}

function describe(s: Stay, currency: string): string {
  const money = (n: number) => formatMoney(n, currency);
  const price = s.nightly != null ? `${money(s.nightly)}/night${s.total != null ? ` (${money(s.total)} total)` : ""}` : "price not shown";
  const rating = s.rating != null ? `, ${s.rating}/${s.ratingScale ?? 5}${s.reviews ? ` (${s.reviews} reviews)` : ""}` : "";
  const extra = [s.kind, s.area, s.badge].filter(Boolean).join(", ");
  return `- ${s.title} — ${price}${rating}${extra ? `, ${extra}` : ""}\n  link: ${s.url}`;
}

function sourceLines(r: StaysData["sources"][number], currency: string): string[] {
  if (r.status === "ok") return [`${r.label}:`, ...r.stays.slice(0, SHOWN_PER_SOURCE).map((s) => describe(s, currency))];
  if (r.status === "link") return [`${r.label}: not searched automatically. Link for the user: ${r.url}`];
  if (r.status === "blocked") return [`${r.label}: blocked by a bot check. Link for the user: ${r.url}`];
  return [`${r.label}: no listings read. Link for the user: ${r.url}`];
}

function withinBudget(stays: Stay[], maxNightly: number | undefined): Stay[] {
  return maxNightly == null ? stays : stays.filter((s) => s.nightly == null || s.nightly <= maxNightly);
}

export function staysTool(deps: Deps) {
  const all = deps.sources ?? STAY_SOURCES;
  return defineTool({
    name: "stays",
    label: "Stays",
    description: `Find hotels and vacation rentals for a trip with real prices for the dates, and show them in one stays card with links for the user to book themselves. Searches ${all.filter((s) => s.read).map((s) => s.label).join(", ")} at the same time; ${all.filter((s) => !s.read).map((s) => s.label).join(", ") || "other sites"} come back as links. Use it instead of web_search for where to stay.`,
    parameters: Type.Object({
      location: Type.String({ minLength: 2, description: "city, neighborhood, or area, e.g. \"Las Vegas Strip\" or \"Shibuya, Tokyo\"" }),
      checkin: Type.String({ description: "YYYY-MM-DD" }),
      checkout: Type.String({ description: "YYYY-MM-DD" }),
      adults: Type.Optional(Type.Number({ description: "default 2" })),
      rooms: Type.Optional(Type.Number({ description: "default 1" })),
      max_price: Type.Optional(Type.Number({ description: "highest nightly price the user wants, in their currency" })),
      type: Type.Optional(Type.Enum(["any", "hotel", "rental"], { description: "default any; rental means homes and apartments" })),
      sources: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()], { description: `only these sites, from: ${all.map((s) => s.id).join(", ")}` })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (!DATE.test(params.checkin) || !DATE.test(params.checkout)) return fail("checkin and checkout must be YYYY-MM-DD");
      const nights = nightsBetween(params.checkin, params.checkout);
      if (!(nights >= 1)) return fail("checkout must be after checkin");
      if (nights > MAX_NIGHTS) return fail(`ask for at most ${MAX_NIGHTS} nights at a time`);
      const q: StayQuery = {
        location: params.location.trim(),
        checkin: params.checkin,
        checkout: params.checkout,
        nights,
        adults: Math.min(Math.max(Math.round(params.adults ?? 2), 1), 16),
        rooms: Math.min(Math.max(Math.round(params.rooms ?? 1), 1), 8),
        currency: deps.currency,
      };
      const sources = pickSources(all, looseList<string>(params.sources).map(String), (params.type as StayKind | "any" | undefined) ?? "any");
      const results: SourceResult[] = await searchStays(sources, q, deps.openTab, { allowPrivateHosts: deps.allowPrivateHosts });
      const maxNightly = params.max_price != null && params.max_price > 0 ? params.max_price : undefined;
      const data: StaysData = {
        kind: "stays",
        location: q.location,
        checkin: q.checkin,
        checkout: q.checkout,
        nights,
        adults: q.adults,
        currency: q.currency,
        ...(maxNightly != null && { maxNightly }),
        sources: results.map((r) => ({ id: r.source.id, label: r.source.label, site: r.source.site, url: r.url, status: r.status, stays: withinBudget(r.stays, maxNightly) })),
      };
      const found = data.sources.reduce((n, s) => n + s.stays.length, 0);
      const head = `Stays in ${q.location}, ${q.checkin} to ${q.checkout} (${nights} ${nights === 1 ? "night" : "nights"}), ${q.adults} ${q.adults === 1 ? "adult" : "adults"}${maxNightly != null ? `, up to ${formatMoney(maxNightly, q.currency)}/night` : ""}.`;
      const note = found
        ? "(Note for you, do not repeat to the user: a stays card with these listings, photos and links is already displayed. Summarize the best options in a sentence or two; don't list them again or put them in show_ui.)"
        : "No listings could be read. Give the user the links below.";
      const lines = [head, note, ...data.sources.flatMap((s) => ["", ...sourceLines(s, q.currency)])];
      return ok(lines.join("\n"), { data });
    },
  });
}
