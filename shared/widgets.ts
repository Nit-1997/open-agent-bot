import { type Static, Type } from "typebox";
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
      durationMin: Type.Number(),
      stops: Type.Number(),
      price: Type.Optional(Type.Number()),
      bookingUrl: Type.Optional(Url),
    }),
  ),
  searchUrl: Url,
  source: Type.String(),
});

export const ProductComparisonSchema = Type.Object({
  kind: Type.Literal("product_comparison"),
  query: Type.String(),
  currency: Type.String(),
  rows: Type.Array(
    Type.Object({
      store: Type.String(),
      title: Type.String(),
      price: Type.Optional(Type.Number()),
      availability: Type.Enum(["in_stock", "out_of_stock", "unknown", "blocked"]),
      url: Url,
      note: Type.Optional(Type.String()),
    }),
  ),
});

export const PlanChecklistSchema = Type.Object({
  kind: Type.Literal("plan_checklist"),
  title: Type.String(),
  sections: Type.Array(
    Type.Object({
      name: Type.String(),
      items: Type.Array(
        Type.Object({
          label: Type.String(),
          quantity: Type.Optional(Type.String()),
          note: Type.Optional(Type.String()),
          url: Type.Optional(Url),
        }),
      ),
    }),
  ),
});

export const WidgetSchemas = {
  weather_card: WeatherCardSchema,
  flight_list: FlightListSchema,
  product_comparison: ProductComparisonSchema,
  plan_checklist: PlanChecklistSchema,
} as const;

export const WidgetSchema = Type.Union([WeatherCardSchema, FlightListSchema, ProductComparisonSchema, PlanChecklistSchema]);

export type WeatherCard = Static<typeof WeatherCardSchema>;
export type FlightList = Static<typeof FlightListSchema>;
export type ProductComparison = Static<typeof ProductComparisonSchema>;
export type PlanChecklist = Static<typeof PlanChecklistSchema>;
export type WidgetPayload = WeatherCard | FlightList | ProductComparison | PlanChecklist;
export type WidgetKind = WidgetPayload["kind"];

export const WIDGET_KINDS = Object.keys(WidgetSchemas) as WidgetKind[];

export function validateWidget(x: unknown): { ok: true; value: WidgetPayload } | { ok: false; errors: string[] } {
  const kind = (x as { kind?: unknown } | null)?.kind;
  if (typeof kind !== "string" || !(kind in WidgetSchemas)) {
    return { ok: false, errors: [`/kind: must be one of ${WIDGET_KINDS.join(", ")}`] };
  }
  const schema = WidgetSchemas[kind as WidgetKind];
  if (Value.Check(schema, x)) return { ok: true, value: x as WidgetPayload };
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const e of Value.Errors(schema, x)) {
    const path = e.instancePath || "/";
    if (seen.has(path)) continue;
    seen.add(path);
    errors.push(`${path}: ${e.message}`);
  }
  return { ok: false, errors };
}
