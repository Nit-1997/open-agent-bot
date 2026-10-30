import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Judge, YesNoCriteria } from "../judge/index.js";
import { stayMatch } from "../judge/criteria/stayMatch.js";
import { type Fx, fx as liveFx } from "../lib/fx.js";
import { formatMoney } from "../shop/currency.js";
import { searchStays } from "../stays/search.js";
import type { OpenTab, SourceResult } from "../stays/types.js";
import { registry as defaultRegistry } from "../sources/index.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { Stay, StayKind, StayQuery, StaySource } from "../stays/types.js";
import { looseList } from "./args.js";
import type { StaysData } from "../render/data.js";
import { fail, ok, type ToolResult } from "./result.js";
import { log } from "../lib/log.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const MAX_NIGHTS = 30;
const SHOWN_PER_SOURCE = 5;
const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", $: "USD", "₹": "INR", "¥": "JPY" };

type Deps = {
  openTab: OpenTab;
  currency: string;
  sources?: StaySource[];
  region?: string;
  registry?: SourceRegistry;
  allowPrivateHosts?: boolean;
  judge?: Judge;
  fx?: Fx;
};

type Budget = { amount: number; currency: string; explicit: boolean };
type Wish = { label: string; criteria: YesNoCriteria; shared: Record<string, unknown> };
type Wants = { brand?: unknown; area?: unknown; vibe?: unknown };

const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function pickSources(all: StaySource[], ids: string[], type: StayKind | "any"): StaySource[] {
  const wanted = ids.map((i) =>
    i
      .trim()
      .toLowerCase()
      .replace(/[\s.-]+/g, "_"),
  );
  const named = wanted.length
    ? all.filter((s) => wanted.some((w) => s.id === w || s.id.startsWith(w) || s.site.startsWith(w.replace(/_/g, "."))))
    : [];
  const pool = named.length ? named : all;
  return type === "any" ? pool : pool.filter((s) => s.lists.includes(type));
}

export function parseBudget(v: unknown, fallback: string): Budget | undefined {
  const raw = typeof v === "object" && v !== null ? (v as { amount?: unknown; currency?: unknown }) : { amount: v };
  const amount = typeof raw.amount === "string" ? Number(raw.amount) : raw.amount;
  if (typeof amount !== "number" || !(amount > 0)) return undefined;
  const named = typeof raw.currency === "string" ? raw.currency.trim() : "";
  const code = CURRENCY_SYMBOLS[named] ?? (/^[A-Za-z]{3}$/.test(named) ? named.toUpperCase() : undefined);
  return { amount, currency: code ?? fallback, explicit: !!code };
}

async function withinBudget(
  stays: Stay[],
  budget: Budget | undefined,
  listed: string,
  rate: Fx,
): Promise<{ stays: Stay[]; unconverted: boolean }> {
  if (!budget) return { stays, unconverted: false };
  const rates = new Map<string, Promise<number | null>>();
  const toBudget = (from: string) => {
    if (!rates.has(from)) rates.set(from, rate(from, budget.currency));
    return rates.get(from) as Promise<number | null>;
  };
  let unconverted = false;
  const kept: Stay[] = [];
  for (const s of stays) {
    if (s.nightly == null) {
      kept.push(s);
      continue;
    }
    const from = s.currency ?? listed;
    const r = from === budget.currency ? 1 : await toBudget(from);
    if (r == null) {
      unconverted = true;
      kept.push(s);
    } else if (s.nightly * r <= budget.amount) kept.push(s);
  }
  return { stays: kept, unconverted };
}

const brandsOf = (wants: Wants | undefined) =>
  looseList<string>(wants?.brand)
    .map((b) => String(b).trim())
    .filter(Boolean);

function wishesOf(wants: Wants | undefined, location: string): Wish[] {
  const brands = brandsOf(wants);
  const area = typeof wants?.area === "string" ? wants.area.trim() : "";
  const vibe = typeof wants?.vibe === "string" ? wants.vibe.trim() : "";
  return [
    ...(brands.length ? [{ label: brands.join("/"), criteria: stayMatch.brand, shared: { brands } }] : []),
    ...(area ? [{ label: `near ${area}`, criteria: stayMatch.area, shared: { area, location } }] : []),
    ...(vibe ? [{ label: vibe, criteria: stayMatch.vibe, shared: { vibe } }] : []),
  ];
}

async function markWishes(judge: Judge, wishes: Wish[], sources: StaysData["sources"]): Promise<boolean> {
  const flat = sources.flatMap((r, si) => r.stays.map((stay, i) => ({ stay, id: `${si}:${i}` })));
  if (!flat.length) return true;
  const items = flat.map(({ stay, id }) => ({
    id,
    state: { title: stay.title, kind: stay.kind ?? "", area: stay.area ?? "", badge: stay.badge ?? "" },
  }));
  const verdicts = await Promise.all(wishes.map((w) => judge.yesno(items, w.criteria, { batch: { shared: w.shared } })));
  if (verdicts.some((v) => v === null)) return false;
  flat.forEach(({ stay }, n) => {
    stay.met = wishes.filter((_, w) => verdicts[w]?.[n]?.yes).map((w) => w.label);
  });
  return true;
}

function rankByWishes(stays: Stay[]): Stay[] {
  const price = (s: Stay) => s.nightly ?? Number.POSITIVE_INFINITY;
  return [...stays].sort((a, b) => (b.met?.length ?? 0) - (a.met?.length ?? 0) || price(a) - price(b));
}

function describe(s: Stay, listed: string): string {
  const money = (n: number) => formatMoney(n, s.currency ?? listed);
  const price = s.nightly != null ? `${money(s.nightly)}/night${s.total != null ? ` (${money(s.total)} total)` : ""}` : "price not shown";
  const rating = s.rating != null ? `, ${s.rating}/${s.ratingScale ?? 5}${s.reviews ? ` (${s.reviews} reviews)` : ""}` : "";
  const extra = [s.kind, s.area, s.badge].filter(Boolean).join(", ");
  const met = s.met?.length ? `\n  matches: ${s.met.map((m) => `✓ ${m}`).join(" · ")}` : "";
  return `- ${s.title} — ${price}${rating}${extra ? `, ${extra}` : ""}${met}\n  link: ${s.url}`;
}

function sourceLines(r: StaysData["sources"][number], currency: string): string[] {
  if (r.status === "ok") return [`${r.label}:`, ...r.stays.slice(0, SHOWN_PER_SOURCE).map((s) => describe(s, currency))];
  if (r.status === "link") return [`${r.label}: not searched automatically. Link for the user: ${r.url}`];
  if (r.status === "blocked") return [`${r.label}: blocked by a bot check. Link for the user: ${r.url}`];
  return [`${r.label}: no listings read. Link for the user: ${r.url}`];
}

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(Math.round(n), min), max);

function nightsOrError(checkin: string, checkout: string): number | string {
  if (!DATE.test(checkin) || !DATE.test(checkout)) return "checkin and checkout must be YYYY-MM-DD";
  const nights = nightsBetween(checkin, checkout);
  if (!(nights >= 1)) return "checkout must be after checkin";
  if (nights > MAX_NIGHTS) return `ask for at most ${MAX_NIGHTS} nights at a time`;
  return nights;
}

async function applyWishes(judge: Judge, wishes: Wish[], data: StaysData, budget: Budget | undefined): Promise<string> {
  if (!(await markWishes(judge, wishes, data.sources))) {
    log.info(`[stays] wants fallback: judge unavailable, price ranking kept (${wishes.map((w) => w.criteria.id).join(",")})`);
    return "Preferences (brand, area, vibe) could not be checked automatically, so listings are in price order. Check names yourself before saying a listing matches.";
  }
  for (const s of data.sources) s.stays = rankByWishes(s.stays);
  const brand = wishes.find((w) => w.criteria === stayMatch.brand);
  if (!brand || data.sources.some((s) => s.stays.some((x) => x.met?.includes(brand.label)))) return "";
  const under = budget ? ` under ${formatMoney(budget.amount, budget.currency)}/night` : "";
  return `No ${brand.label.replace(/\//g, " or ")}${under} in these results.`;
}

function resultText(data: StaysData, q: StayQuery, budget: Budget | undefined, unconverted: boolean, wishNote: string): string {
  const found = data.sources.reduce((n, s) => n + s.stays.length, 0);
  const budgetText = budget ? `, up to ${formatMoney(budget.amount, budget.currency)}/night` : "";
  const head = `Stays in ${q.location}, ${q.checkin} to ${q.checkout} (${q.nights} ${q.nights === 1 ? "night" : "nights"}), ${q.adults} ${q.adults === 1 ? "adult" : "adults"}${budgetText}.`;
  const note = found
    ? "(Note for you, do not repeat to the user: a stays card with these listings, photos and links is already displayed. Summarize the best options in a sentence or two; don't list them again or put them in show_ui.)"
    : "No listings could be read. Give the user the links below.";
  const fxNote = unconverted
    ? "Some prices are in a different currency and the exchange rate could not be fetched, so the budget was not applied. Say that, and check the prices against the budget yourself."
    : "";
  return [
    head,
    ...(fxNote ? [fxNote] : []),
    ...(wishNote ? [wishNote] : []),
    note,
    ...data.sources.flatMap((s) => ["", ...sourceLines(s, q.currency)]),
  ].join("\n");
}

export function staysTool(deps: Deps) {
  const all = deps.sources ?? (deps.registry ?? defaultRegistry).select<StaySource>({ vertical: "stays", region: deps.region });
  const rate = deps.fx ?? liveFx;
  const judge = deps.judge;
  const wantsHelp = judge
    ? " Pass wants with brand (hotel chains, sub-brands count), area (a neighborhood or landmark) and vibe when the user names any: each listing is checked against them, matches are shown on the card, and listings that meet the most wishes come first. The result says plainly when no listing meets the brand."
    : "";
  return defineTool({
    name: "stays",
    label: "Stays",
    description: `Find hotels and vacation rentals for a trip with real prices for the dates, and show them in one stays card with links for the user to book themselves. Searches ${all
      .filter((s) => s.read)
      .map((s) => s.label)
      .join(", ")} at the same time; ${
      all
        .filter((s) => !s.read)
        .map((s) => s.label)
        .join(", ") || "other sites"
    } come back as links. Use it instead of web_search for where to stay. max_price is a nightly budget: a number in the user's currency, or { amount, currency } when they name one (e.g. { amount: 400, currency: "EUR" }); prices are shown in that currency.${wantsHelp}\n\nCall it once; type "rental" for homes and apartments, "hotel" for hotels. Don't browse booking sites or repeat its listings in show_ui. Then name the best one or two picks in a sentence.`,
    parameters: Type.Object({
      location: Type.String({ minLength: 2, description: 'city, neighborhood, or area, e.g. "Las Vegas Strip" or "Shibuya, Tokyo"' }),
      checkin: Type.String({ description: "YYYY-MM-DD" }),
      checkout: Type.String({ description: "YYYY-MM-DD" }),
      adults: Type.Optional(Type.Number({ description: "default 2" })),
      rooms: Type.Optional(Type.Number({ description: "default 1" })),
      max_price: Type.Optional(
        Type.Union(
          [Type.Number(), Type.Object({ amount: Type.Number(), currency: Type.String({ description: "ISO code such as EUR, GBP, USD" }) })],
          {
            description:
              "highest nightly price the user wants: a number in their currency, or { amount, currency } when they named another currency",
          },
        ),
      ),
      ...(judge && {
        wants: Type.Optional(
          Type.Object(
            {
              brand: Type.Optional(
                Type.Union([Type.Array(Type.String()), Type.String()], {
                  description: 'hotel chains the user wants, e.g. ["Marriott", "Hyatt"]',
                }),
              ),
              area: Type.Optional(Type.String({ description: 'neighborhood or landmark to be near, e.g. "the Louvre"' })),
              vibe: Type.Optional(Type.String({ description: 'the feel they want, e.g. "quiet boutique"' })),
            },
            { description: "preferences each listing is checked against" },
          ),
        ),
      }),
      type: Type.Optional(Type.Enum(["any", "hotel", "rental"], { description: "default any; rental means homes and apartments" })),
      sources: Type.Optional(
        Type.Union([Type.Array(Type.String()), Type.String()], {
          description: `only these sites, from: ${all.map((s) => s.id).join(", ")}`,
        }),
      ),
    }),
    async execute(_id, params): Promise<ToolResult> {
      const nights = nightsOrError(params.checkin, params.checkout);
      if (typeof nights === "string") return fail(nights);
      const budget = parseBudget(params.max_price, deps.currency);
      const wants = params.wants as Wants | undefined;
      const brands = judge ? brandsOf(wants) : [];
      const q: StayQuery = {
        location: params.location.trim(),
        checkin: params.checkin,
        checkout: params.checkout,
        nights,
        adults: clamp(params.adults ?? 2, 1, 16),
        rooms: clamp(params.rooms ?? 1, 1, 8),
        currency: budget?.explicit ? budget.currency : deps.currency,
        ...(brands.length && { brands }),
      };
      const kind = (params.type as StayKind | "any" | undefined) ?? "any";
      const sources = pickSources(all, looseList<string>(params.sources).map(String), kind);
      const results: SourceResult[] = await searchStays(sources, q, deps.openTab, { allowPrivateHosts: deps.allowPrivateHosts });
      const filtered = await Promise.all(results.map((r) => withinBudget(r.stays, budget, q.currency, rate)));
      const unconverted = filtered.some((f) => f.unconverted);
      const data: StaysData = {
        kind: "stays",
        location: q.location,
        checkin: q.checkin,
        checkout: q.checkout,
        nights,
        adults: q.adults,
        currency: q.currency,
        ...(budget && !unconverted && { maxNightly: budget.amount }),
        sources: results.map((r, i) => ({
          id: r.source.id,
          label: r.source.label,
          site: r.source.site,
          url: r.url,
          status: r.status,
          stays: filtered[i].stays,
        })),
      };
      const wishes = judge ? wishesOf(wants, q.location) : [];
      const wishNote = judge && wishes.length ? await applyWishes(judge, wishes, data, unconverted ? undefined : budget) : "";
      return ok(resultText(data, q, budget, unconverted, wishNote), { data });
    },
  });
}
