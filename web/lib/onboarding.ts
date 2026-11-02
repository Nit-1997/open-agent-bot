import {
  KIDS_ANY,
  NO_AIRLINE,
  NO_DELIVERY,
  NO_FOOD_RULES,
  type OnboardingOptions,
  PETS_ANY,
  type Place,
  SHOPPING_STYLES,
  TRAVEL_STYLES,
} from "@shared/onboarding";
import { agentPersona, type Home, type Profile, type Section } from "@shared/profile";
import { TAG_MAX } from "@shared/profile";

export type SlideId = "agent" | "model" | "you" | "travel" | "shopping" | "jev" | "summary";

export function slideOrder(opts: { modelFirst: boolean; showJev: boolean }): SlideId[] {
  const middle: SlideId[] = ["you", "travel", "shopping", ...(opts.showJev ? (["jev"] as const) : [])];
  return [
    "agent",
    ...(opts.modelFirst ? ["model" as const, ...middle, "summary" as const] : [...middle, "model" as const, "summary" as const]),
  ];
}

export function toggle(list: string[], value: string, exclusive: string[] = []): string[] {
  if (list.includes(value)) return list.filter((x) => x !== value);
  if (exclusive.includes(value)) return [value];
  return [...list.filter((x) => !exclusive.includes(x)), value];
}

export function cleanTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, TAG_MAX);
}

export function addTag(list: string[], raw: string, exclusive: string[] = []): string[] {
  const tag = cleanTag(raw);
  if (!tag || list.some((x) => x.toLowerCase() === tag.toLowerCase())) return list;
  return [...list.filter((x) => !exclusive.includes(x)), tag];
}

export function homeFromPlace(p: Place): Home {
  return {
    label: p.label,
    ...(p.city && { city: p.city }),
    ...(p.region && { region: p.region }),
    ...(p.country && { country: p.country }),
    lat: p.lat,
    lon: p.lon,
  };
}

export function browserCountry(locale: string | undefined): string | undefined {
  const region = locale?.split(/[-_]/)[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : undefined;
}

export function optionsQuery(home: Home | undefined, locale?: string): string {
  const q = new URLSearchParams();
  if (home?.lat != null && home.lon != null) {
    q.set("lat", home.lat.toFixed(4));
    q.set("lon", home.lon.toFixed(4));
  }
  const country = home?.country ?? browserCountry(locale);
  if (country) q.set("country", country);
  return q.toString();
}

export function detectedLine(home: Home | undefined, options: OnboardingOptions | null): string | null {
  if (!home?.city || !options) return null;
  return [
    home.city,
    options.currency,
    options.units === "imperial" ? "°F" : "°C",
    options.airports.length ? `airports ${options.airports.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const list = (xs: string[]) => xs.join(", ");
const styleLabel = <T extends { id: string; label: string }>(all: readonly T[], id: string | undefined) =>
  all.find((s) => s.id === id)?.label.toLowerCase();

function householdText(p: Profile): string {
  const h = p.household;
  const kids = h.kids.filter((k) => k !== KIDS_ANY);
  const pets = h.pets.filter((k) => k !== PETS_ANY);
  return [
    h.partner && "partner",
    h.kids.length > 0 && (kids.length ? `kids ${kids.join(", ")}` : "kids"),
    h.pets.length > 0 && (pets.length ? pets.join(", ").toLowerCase() : "pets"),
    ...h.other,
  ]
    .filter(Boolean)
    .join(", ");
}

export type SummaryLine = { slide: SlideId; label: string; text: string };

export function summaryLines(p: Profile, opts: { jev?: string | null; modelLabel?: string } = {}): SummaryLine[] {
  const skipped = (s: Section) => p.skipped.includes(s);
  const or = (text: string, s: Section) => (skipped(s) ? "skipped" : text || "nothing yet");
  const t = p.travel;
  const s = p.shopping;
  const food = p.food.map((f) => (f === NO_FOOD_RULES ? "no food restrictions" : f.toLowerCase()));
  const you = [p.name, p.home?.city ? [p.home.city, p.home.region].filter(Boolean).join(", ") : p.home?.label].filter(Boolean).join(" · ");
  const agent = agentPersona(p);
  const lines: SummaryLine[] = [
    { slide: "agent", label: "Your agent", text: `${agent.name} · ${agent.tone} · ${agent.look} look` },
    { slide: "you", label: "You", text: or(you, "you") },
    { slide: "you", label: "Household", text: or([householdText(p), ...food].filter(Boolean).join(" · "), "you") },
    {
      slide: "travel",
      label: "Travel",
      text: or(
        [
          styleLabel(TRAVEL_STYLES, t.style),
          list(t.airlines.filter((a) => a !== NO_AIRLINE)),
          t.stays.length === 2 ? "hotels + rentals" : t.stays[0] === "hotel" ? "hotels" : t.stays[0] === "rental" ? "rentals" : "",
          list(t.hotelChains),
          t.sites.length ? `books on ${list(t.sites)}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        "travel",
      ),
    },
    {
      slide: "shopping",
      label: "Shopping",
      text: or(
        [
          styleLabel(SHOPPING_STYLES, s.style),
          list(s.groceries),
          list(s.retail),
          s.delivery.filter((d) => d !== NO_DELIVERY).length ? `delivers with ${list(s.delivery.filter((d) => d !== NO_DELIVERY))}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        "shopping",
      ),
    },
  ];
  if (opts.jev !== undefined) lines.push({ slide: "jev", label: "Jev", text: opts.jev ? `on (${opts.jev})` : "off" });
  lines.push({ slide: "model", label: "Model", text: opts.modelLabel ?? "not chosen yet" });
  return lines;
}

export function travelers(p: Profile): number {
  const kids = p.household.kids.filter((k) => k !== KIDS_ANY).length || (p.household.kids.length ? 1 : 0);
  return 1 + (p.household.partner ? 1 : 0) + kids;
}

const isVeg = (p: Profile) => p.food.some((f) => /vegetarian|vegan/i.test(f));
const isNutFree = (p: Profile) => p.food.some((f) => /nut/i.test(f));

export function starters(p: Profile, airports: string[]): string[] {
  const n = travelers(p);
  const from = airports[0] ?? p.home?.city;
  const who = n === 1 ? "me" : `the ${n} of us`;
  const store = p.shopping.groceries[0];
  const kidAge = p.household.kids.find((k) => k !== KIDS_ANY);
  const youngest = kidAge ? Number(kidAge.split(/[–-]/)[0]) + 2 : undefined;
  const out = [
    `Weekend trip${from ? ` from ${from}` : ""} for ${who}`,
    `${isVeg(p) ? "Veggie taco" : "Taco"} night${store ? ` at ${store}` : ""}`,
    p.household.kids.length
      ? `${isNutFree(p) ? "Nut-free birthday" : "Birthday"} party for a${youngest === 8 || youngest === 11 ? "n" : ""} ${youngest ?? 6}-year-old`
      : p.travel.style === "luxury"
        ? "A splurge-worthy dinner spot this Saturday"
        : "Cheap eats near me this weekend",
  ];
  return out;
}

export function jevProvider(providers: Array<{ id: string; configured: boolean; label: string }> | null): string | null {
  const p = ["typesafe", "openrouter"].map((id) => providers?.find((x) => x.id === id && x.configured)).find(Boolean);
  return p?.label ?? null;
}
