import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

const Url = Type.String({ minLength: 1 });

export const WeatherCardSchema = Type.Object({
  kind: Type.Literal("weather_card"),
  location: Type.String(),
  units: Type.Enum(["metric", "imperial"]),
  current: Type.Object({ temp: Type.Number(), condition: Type.String() }),
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
    }),
  ),
  searchUrl: Url,
  source: Type.String(),
});

const Str = Type.String();

export const UiBlockSchemas = {
  heading: Type.Object({ type: Type.Literal("heading"), text: Str }),
  text: Type.Object({ type: Type.Literal("text"), text: Str }),
  stats: Type.Object({
    type: Type.Literal("stats"),
    items: Type.Array(Type.Object({ label: Str, value: Str, note: Type.Optional(Str) }), { minItems: 1 }),
  }),
  table: Type.Object({ type: Type.Literal("table"), columns: Type.Array(Str, { minItems: 1 }), rows: Type.Array(Type.Array(Str)) }),
  list: Type.Object({
    type: Type.Literal("list"),
    items: Type.Array(
      Type.Object({ title: Str, subtitle: Type.Optional(Str), value: Type.Optional(Str), badge: Type.Optional(Str), url: Type.Optional(Url) }),
      { minItems: 1 },
    ),
  }),
  checklist: Type.Object({
    type: Type.Literal("checklist"),
    title: Type.Optional(Str),
    items: Type.Array(Type.Object({ text: Str, note: Type.Optional(Str) }), { minItems: 1 }),
  }),
  links: Type.Object({ type: Type.Literal("links"), items: Type.Array(Type.Object({ label: Str, url: Url }), { minItems: 1 }) }),
  callout: Type.Object({ type: Type.Literal("callout"), tone: Type.Enum(["info", "warning", "success"]), text: Str }),
} as const;

export const UI_BLOCK_TYPES = Object.keys(UiBlockSchemas) as UiBlockType[];
const B = UiBlockSchemas;
export const UiBlockSchema = Type.Union([B.heading, B.text, B.stats, B.table, B.list, B.checklist, B.links, B.callout]);

export const UiSchema = Type.Object({
  kind: Type.Literal("ui"),
  title: Str,
  subtitle: Type.Optional(Str),
  blocks: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 20 }),
  unverified: Type.Optional(Type.Array(Str)),
  removedLinks: Type.Optional(Type.Number()),
});

export const GroundingNoteSchema = Type.Object({
  kind: Type.Literal("grounding_note"),
  claims: Type.Array(Str, { minItems: 1 }),
});

export const WidgetSchemas = {
  weather_card: WeatherCardSchema,
  flight_list: FlightListSchema,
  ui: UiSchema,
  grounding_note: GroundingNoteSchema,
} as const;

export type WeatherCard = Static<typeof WeatherCardSchema>;
export type FlightList = Static<typeof FlightListSchema>;
export type UiBlockType = keyof typeof UiBlockSchemas;
export type UiBlock = Static<typeof UiBlockSchema>;
export type UiWidget = Omit<Static<typeof UiSchema>, "blocks"> & { blocks: UiBlock[] };
export type GroundingNote = Static<typeof GroundingNoteSchema>;
export type WidgetPayload = WeatherCard | FlightList | UiWidget | GroundingNote;
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

function blockErrors(blocks: unknown[]): string[] {
  return blocks.flatMap((b, i) => {
    const type = (b as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !(type in UiBlockSchemas)) return [`/blocks/${i}/type: must be one of ${UI_BLOCK_TYPES.join(", ")}`];
    return schemaErrors(UiBlockSchemas[type as UiBlockType], b, `/blocks/${i}`);
  });
}

export function validateWidget(x: unknown): { ok: true; value: WidgetPayload } | { ok: false; errors: string[] } {
  const kind = (x as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !(kind in WidgetSchemas)) {
    return { ok: false, errors: [`/kind: must be one of ${WIDGET_KINDS.join(", ")}`] };
  }
  const schema = WidgetSchemas[kind as WidgetKind];
  const errors = schemaErrors(schema, x);
  if (!errors.length && kind === "ui") errors.push(...blockErrors((x as { blocks: unknown[] }).blocks));
  return errors.length ? { ok: false, errors } : { ok: true, value: x as WidgetPayload };
}
