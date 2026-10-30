import { type Static, Type } from "typebox";
import { Value } from "typebox/value";

export const TAG_MAX = 60;
export const LIST_MAX = 20;

const Tag = Type.String({ minLength: 1, maxLength: TAG_MAX });
const Tags = Type.Array(Tag, { maxItems: LIST_MAX });
const Short = (max: number) => Type.String({ maxLength: max });

export const HomeSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 200 }),
  city: Type.Optional(Short(100)),
  region: Type.Optional(Short(100)),
  country: Type.Optional(Type.String({ pattern: "^[A-Z]{2}$" })),
  lat: Type.Optional(Type.Number({ minimum: -90, maximum: 90 })),
  lon: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
});

export const SECTIONS = ["you", "travel", "shopping", "jev"] as const;
export type Section = (typeof SECTIONS)[number];

export const ProfileSchema = Type.Object({
  name: Type.Optional(Short(80)),
  home: Type.Optional(HomeSchema),
  household: Type.Object({ partner: Type.Boolean(), kids: Tags, pets: Tags, other: Tags }),
  food: Tags,
  travel: Type.Object({
    style: Type.Optional(Type.Union([Type.Literal("budget"), Type.Literal("comfort"), Type.Literal("luxury")])),
    airlines: Tags,
    stays: Type.Array(Type.Union([Type.Literal("hotel"), Type.Literal("rental")]), { maxItems: 2 }),
    hotelChains: Tags,
    sites: Tags,
  }),
  shopping: Type.Object({
    style: Type.Optional(Type.Union([Type.Literal("save"), Type.Literal("balanced"), Type.Literal("treat")])),
    groceries: Tags,
    retail: Tags,
    delivery: Tags,
  }),
  defaultModel: Type.Optional(Type.String({ minLength: 3, maxLength: 200 })),
  notes: Type.Optional(Short(1000)),
  skipped: Type.Array(Type.Union([Type.Literal("you"), Type.Literal("travel"), Type.Literal("shopping"), Type.Literal("jev")]), {
    maxItems: SECTIONS.length,
  }),
  onboardedAt: Type.Optional(Type.String({ maxLength: 40 })),
});

export type Profile = Static<typeof ProfileSchema>;
export type Home = Static<typeof HomeSchema>;
export type StayKind = Profile["travel"]["stays"][number];

export function emptyProfile(): Profile {
  return {
    household: { partner: false, kids: [], pets: [], other: [] },
    food: [],
    travel: { airlines: [], stays: [], hotelChains: [], sites: [] },
    shopping: { groceries: [], retail: [], delivery: [] },
    skipped: [],
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const CLIP: Record<string, number> = { name: 80, notes: 1000, label: 200, city: 100, region: 100, defaultModel: 200, onboardedAt: 40 };

function tidy(v: unknown, key = ""): unknown {
  if (typeof v === "string") return v.trim().slice(0, CLIP[key] ?? TAG_MAX);
  if (Array.isArray(v)) {
    const seen = new Set<string>();
    return v
      .map((x) => tidy(x))
      .filter((x): x is string => {
        if (typeof x !== "string") return false;
        const k = x.toLowerCase();
        if (!x || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, LIST_MAX);
  }
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tidy(x, k)]));
  return v;
}

function merge(base: unknown, patch: unknown): unknown {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = k === "home" ? v : merge(base[k], v);
  return out;
}

export function parseProfile(v: unknown): Profile | null {
  if (!isObject(v)) return null;
  const candidate = Value.Clean(ProfileSchema, merge(emptyProfile(), tidy(structuredClone(v))));
  for (const key of ["name", "notes", "defaultModel", "onboardedAt"] as const) {
    if ((candidate as Record<string, unknown>)[key] === "") delete (candidate as Record<string, unknown>)[key];
  }
  return Value.Check(ProfileSchema, candidate) ? (candidate as Profile) : null;
}

export function homePlace(home: Home | undefined): string | undefined {
  if (!home?.city) return undefined;
  return [home.city, home.region, home.country].filter(Boolean).join(", ");
}
