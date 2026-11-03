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

export const SECTIONS = ["agent", "you", "travel", "shopping", "jev"] as const;
export type Section = (typeof SECTIONS)[number];

export const AGENT_LOOKS = ["mist", "ember", "moss", "dusk"] as const;
export const AGENT_TONES = ["brief", "warm", "thorough"] as const;
export type AgentLook = (typeof AGENT_LOOKS)[number];
export type AgentTone = (typeof AGENT_TONES)[number];

export const AGENT_NAME_MAX = 40;
export const AGENT_NAME_SUGGESTIONS = ["Atlas", "Ivy", "Milo", "Sage"] as const;
export type AgentPersona = { name: string; look: AgentLook; tone: AgentTone };
export const DEFAULT_AGENT = { name: "Juno", look: "mist", tone: "warm" } as const satisfies AgentPersona;

export const AgentSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: AGENT_NAME_MAX })),
    look: Type.Optional(Type.Union([Type.Literal("mist"), Type.Literal("ember"), Type.Literal("moss"), Type.Literal("dusk")])),
    tone: Type.Optional(Type.Union([Type.Literal("brief"), Type.Literal("warm"), Type.Literal("thorough")])),
  },
  { additionalProperties: false },
);

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

const NAME_EMPTY = "Give your agent a name.";
const NAME_LONG = `Keep it to ${AGENT_NAME_MAX} characters.`;
const NAME_CHARS = "Use letters, numbers, spaces, apostrophes, hyphens or periods.";
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.-]*$/u;
const STACKED_MARKS = /\p{M}{3}/u;
const CONTROL = /\p{Cc}/u;

export function checkAgentName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, error: NAME_EMPTY };
  if (CONTROL.test(raw)) return { ok: false, error: NAME_CHARS };
  const name = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name) return { ok: false, error: NAME_EMPTY };
  if (Array.from(name).length > AGENT_NAME_MAX) return { ok: false, error: NAME_LONG };
  if (!NAME_RE.test(name) || STACKED_MARKS.test(name)) return { ok: false, error: NAME_CHARS };
  return { ok: true, name };
}

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
  skipped: Type.Array(
    Type.Union([Type.Literal("agent"), Type.Literal("you"), Type.Literal("travel"), Type.Literal("shopping"), Type.Literal("jev")]),
    { maxItems: SECTIONS.length },
  ),
  agent: Type.Optional(AgentSchema),
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
  if (!Value.Check(ProfileSchema, candidate)) return null;
  const profile = candidate as Profile;
  if (profile.agent?.name === undefined) return profile;
  const name = checkAgentName(profile.agent.name);
  return name.ok ? { ...profile, agent: { ...profile.agent, name: name.name } } : null;
}

export function withoutInvalidAgent(v: unknown): { value: unknown; dropped: boolean } {
  if (!isObject(v) || !("agent" in v)) return { value: v, dropped: false };
  const agent = Value.Clean(AgentSchema, structuredClone(v.agent));
  const valid = Value.Check(AgentSchema, agent) && (agent.name === undefined || checkAgentName(agent.name).ok);
  if (valid) return { value: v, dropped: false };
  const { agent: _dropped, ...rest } = v;
  return { value: rest, dropped: true };
}

export function agentPersona(p: Pick<Profile, "agent"> | undefined): AgentPersona {
  const a = p?.agent;
  return { name: a?.name ?? DEFAULT_AGENT.name, look: a?.look ?? DEFAULT_AGENT.look, tone: a?.tone ?? DEFAULT_AGENT.tone };
}

export function homePlace(home: Home | undefined): string | undefined {
  if (!home?.city) return undefined;
  return [home.city, home.region, home.country].filter(Boolean).join(", ");
}
