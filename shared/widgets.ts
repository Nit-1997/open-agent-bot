import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

const Url = Type.String({ minLength: 1 });

export const WeatherCardSchema = Type.Object({
  kind: Type.Literal("weather_card"),
  mode: Type.Optional(Type.Enum(["forecast", "typical"])),
  basis: Type.Optional(Type.String({ description: "years averaged for typical weather, e.g. 2023–2025" })),
  location: Type.String(),
  units: Type.Enum(["metric", "imperial"]),
  current: Type.Optional(Type.Object({ temp: Type.Number(), condition: Type.String() })),
  days: Type.Array(
    Type.Object({
      date: Type.String(),
      high: Type.Number(),
      low: Type.Number(),
      condition: Type.String(),
      precipChance: Type.Optional(Type.Number()),
    }),
  ),
  source: Type.String(),
});

export const FlightListSchema = Type.Object({
  kind: Type.Literal("flight_list"),
  from: Type.String(),
  to: Type.String(),
  date: Type.String(),
  currency: Type.String(),
  flights: Type.Array(
    Type.Object({
      airline: Type.String(),
      departTime: Type.String(),
      arriveTime: Type.String(),
      duration: Type.String({ description: "as shown on the page, e.g. 28h 25m" }),
      stops: Type.Number(),
      price: Type.Optional(Type.Number()),
      origin: Type.Optional(Type.String()),
      layoverMinutes: Type.Optional(Type.Number()),
      layoverAt: Type.Optional(Type.String()),
    }),
  ),
  airports: Type.Optional(
    Type.Array(
      Type.Object({
        code: Type.String(),
        name: Type.Optional(Type.String()),
        miles: Type.Optional(Type.Number()),
        driveMinutes: Type.Optional(Type.Number()),
        rideOneWay: Type.Optional(Type.Number({ description: "estimated one-way rideshare from home" })),
        status: Type.Enum(["ok", "failed"]),
        searchUrl: Url,
      }),
    ),
  ),
  prefs: Type.Optional(
    Type.Object({
      maxLayover: Type.Optional(Type.Enum(["nonstop", "5h", "10h", "any"])),
      times: Type.Optional(Type.Array(Type.Enum(["early_morning", "midday", "evening", "late_night"]))),
    }),
  ),
  returnDate: Type.Optional(Type.String()),
  priceNote: Type.Optional(Type.String()),
  searchUrl: Url,
  source: Type.String(),
});

const Str = Type.String();

const S = (maxLength: number) => Type.String({ maxLength });

export const UiBlockSchemas = {
  heading: Type.Object({ type: Type.Literal("heading"), text: S(40) }),
  text: Type.Object({ type: Type.Literal("text"), text: S(280) }),
  stats: Type.Object({
    type: Type.Literal("stats"),
    items: Type.Array(Type.Object({ label: S(24), value: S(20), note: Type.Optional(S(40)) }), { minItems: 1, maxItems: 4 }),
  }),
  table: Type.Object({
    type: Type.Literal("table"),
    columns: Type.Array(S(24), { minItems: 1, maxItems: 5 }),
    rows: Type.Array(Type.Array(S(48), { maxItems: 5 }), { maxItems: 10 }),
  }),
  list: Type.Object({
    type: Type.Literal("list"),
    items: Type.Array(
      Type.Object({ title: S(60), subtitle: Type.Optional(S(90)), value: Type.Optional(S(20)), badge: Type.Optional(S(16)), url: Type.Optional(Url) }),
      { minItems: 1, maxItems: 10 },
    ),
  }),
  cards: Type.Object({
    type: Type.Literal("cards"),
    shape: Type.Optional(Type.Enum(["square", "wide"])),
    items: Type.Array(
      Type.Object({
        title: S(60),
        subtitle: Type.Optional(S(60)),
        image: Type.Optional(Url),
        url: Type.Optional(Url),
        price: Type.Optional(S(20)),
        rating: Type.Optional(S(12)),
        source: Type.Optional(S(30)),
        place: Type.Optional(S(100)),
        note: Type.Optional(S(60)),
        badge: Type.Optional(S(16)),
      }),
      { minItems: 1, maxItems: 10 },
    ),
  }),
  image: Type.Object({ type: Type.Literal("image"), url: Url, caption: Type.Optional(S(100)), source: Type.Optional(S(30)) }),
  checklist: Type.Object({
    type: Type.Literal("checklist"),
    title: Type.Optional(S(40)),
    items: Type.Array(Type.Object({ text: S(80), note: Type.Optional(S(60)) }), { minItems: 1, maxItems: 12 }),
  }),
  links: Type.Object({ type: Type.Literal("links"), items: Type.Array(Type.Object({ label: S(30), url: Url }), { minItems: 1, maxItems: 6 }) }),
  callout: Type.Object({ type: Type.Literal("callout"), tone: Type.Enum(["info", "warning", "success"]), text: S(160) }),
} as const;

export const UI_BLOCK_TYPES = Object.keys(UiBlockSchemas) as UiBlockType[];
const B = UiBlockSchemas;
export const UiBlockSchema = Type.Union([B.heading, B.text, B.stats, B.table, B.list, B.cards, B.image, B.checklist, B.links, B.callout]);

export const UiSchema = Type.Object({
  kind: Type.Literal("ui"),
  title: S(60),
  subtitle: Type.Optional(S(80)),
  blocks: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 8 }),
  unverified: Type.Optional(Type.Array(Str)),
  removedLinks: Type.Optional(Type.Number()),
});

const IsoDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD" });

export const AskFieldSchemas = {
  date_range: Type.Object({ type: Type.Literal("date_range"), label: Str, start: IsoDate, end: IsoDate }),
  number: Type.Object({
    type: Type.Literal("number"),
    label: Str,
    value: Type.Optional(Type.Number()),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
  }),
  choice: Type.Object({
    type: Type.Literal("choice"),
    label: Str,
    options: Type.Array(Str, { minItems: 2, maxItems: 8 }),
    value: Type.Optional(Str),
  }),
  text: Type.Object({ type: Type.Literal("text"), label: Str, value: Type.Optional(Str), placeholder: Type.Optional(Str) }),
} as const;

export const ASK_FIELD_TYPES = Object.keys(AskFieldSchemas) as AskFieldType[];
const A = AskFieldSchemas;
export const AskFieldSchema = Type.Union([A.date_range, A.number, A.choice, A.text]);

export const AskSchema = Type.Object({
  kind: Type.Literal("ask"),
  question: Str,
  fields: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 6 }),
  submitLabel: Type.Optional(Str),
});

export const GroundingNoteSchema = Type.Object({
  kind: Type.Literal("grounding_note"),
  claims: Type.Array(Str, { minItems: 1 }),
});

const CartPickSchema = Type.Object({
  title: Str,
  price: Type.Optional(Type.Number()),
  priceText: Type.Optional(Str),
  image: Type.Optional(Url),
  url: Url,
  size: Type.Optional(Str),
  rating: Type.Optional(Type.Number()),
  sponsored: Type.Optional(Type.Boolean()),
});

export const CartSchema = Type.Object({
  kind: Type.Literal("cart"),
  stores: Type.Array(
    Type.Object({
      name: Str,
      total: Type.Number(),
      url: Url,
      missing: Type.Array(Str),
      items: Type.Array(Type.Object({ query: Str, qty: Type.Number(), picks: Type.Array(CartPickSchema, { maxItems: 3 }) }), { minItems: 1, maxItems: 12 }),
    }),
    { minItems: 1, maxItems: 6 },
  ),
});

export const FollowupsSchema = Type.Object({
  kind: Type.Literal("followups"),
  replies: Type.Array(S(40), { minItems: 1, maxItems: 4 }),
});

export const WidgetSchemas = {
  weather_card: WeatherCardSchema,
  flight_list: FlightListSchema,
  ui: UiSchema,
  grounding_note: GroundingNoteSchema,
  ask: AskSchema,
  followups: FollowupsSchema,
  cart: CartSchema,
} as const;

export type WeatherCard = Static<typeof WeatherCardSchema>;
export type FlightList = Static<typeof FlightListSchema>;
export type UiBlockType = keyof typeof UiBlockSchemas;
export type UiBlock = Static<typeof UiBlockSchema>;
export type UiWidget = Omit<Static<typeof UiSchema>, "blocks"> & { blocks: UiBlock[] };
export type GroundingNote = Static<typeof GroundingNoteSchema>;
export type AskFieldType = keyof typeof AskFieldSchemas;
export type AskField = Static<typeof AskFieldSchema>;
export type AskWidget = Omit<Static<typeof AskSchema>, "fields"> & { fields: AskField[] };
export type Followups = Static<typeof FollowupsSchema>;
export type Cart = Static<typeof CartSchema>;
export type WidgetPayload = WeatherCard | FlightList | UiWidget | GroundingNote | AskWidget | Followups | Cart;
export type WidgetKind = WidgetPayload["kind"];

export const WIDGET_KINDS = Object.keys(WidgetSchemas) as WidgetKind[];

function schemaErrors(schema: TSchema, x: unknown, prefix = ""): string[] {
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const e of Value.Errors(schema, x)) {
    const path = prefix + (e.instancePath || (prefix ? "" : "/"));
    if (seen.has(path)) continue;
    seen.add(path);
    errors.push(`${path}: ${e.message}`);
  }
  return errors;
}

function itemErrors(items: unknown[], schemas: Record<string, TSchema>, path: string): string[] {
  return items.flatMap((b, i) => {
    const type = (b as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !(type in schemas)) return [`/${path}/${i}/type: must be one of ${Object.keys(schemas).join(", ")}`];
    return schemaErrors(schemas[type], b, `/${path}/${i}`);
  });
}

function rangeErrors(fields: AskField[]): string[] {
  return fields.flatMap((f, i) => (f.type === "date_range" && f.end < f.start ? [`/fields/${i}/end: must not be before start`] : []));
}

export function validateWidget(x: unknown): { ok: true; value: WidgetPayload } | { ok: false; errors: string[] } {
  const kind = (x as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !(kind in WidgetSchemas)) {
    return { ok: false, errors: [`/kind: must be one of ${WIDGET_KINDS.join(", ")}`] };
  }
  const schema = WidgetSchemas[kind as WidgetKind];
  const errors = schemaErrors(schema, x);
  if (!errors.length && kind === "ui") errors.push(...itemErrors((x as { blocks: unknown[] }).blocks, UiBlockSchemas, "blocks"));
  if (!errors.length && kind === "ask") {
    const fields = (x as { fields: unknown[] }).fields;
    errors.push(...itemErrors(fields, AskFieldSchemas, "fields"));
    if (!errors.length) errors.push(...rangeErrors(fields as AskField[]));
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: x as WidgetPayload };
}
