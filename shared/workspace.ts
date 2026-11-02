import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { EventEntitySchema, ShortlistEntitySchema, TripEntitySchema } from "./widgets.ts";

export { EventEntitySchema, ShortlistEntitySchema, TripEntitySchema };

const Str = Type.String({ maxLength: 500 });

export const PickSchema = Type.Object({ title: Str, url: Type.String({ minLength: 1 }) }, { additionalProperties: true });

export const CartEntitySchema = Type.Object({
  stores: Type.Array(Str, { maxItems: 10 }),
  scope: Type.Array(Str, { maxItems: 10 }),
  items: Type.Array(Type.Object({ query: Str, qty: Type.Number({ minimum: 1 }) }), { maxItems: 100 }),
  homes: Type.Record(Type.String(), Type.String()),
  picks: Type.Record(Type.String(), Type.Record(Type.String(), Type.Array(PickSchema, { maxItems: 10 }))),
});

const Count = Type.Integer({ minimum: 1, maximum: 10_000 });
const Day = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}", maxLength: 40 });
const Money = Type.Number({ minimum: 0 });

export const CartEditsSchema = Type.Object(
  {
    removed: Type.Optional(Type.Array(Str, { maxItems: 50 })),
    qty: Type.Optional(Type.Record(Type.String(), Count)),
    picks: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Str))),
  },
  { additionalProperties: false },
);

export const EventEditsSchema = Type.Object(
  { guests: Type.Optional(Count), date: Type.Optional(Day), budget: Type.Optional(Money) },
  { additionalProperties: false },
);

export const TripEditsSchema = Type.Object(
  { start: Type.Optional(Day), end: Type.Optional(Day), travelers: Type.Optional(Count), budget: Type.Optional(Money) },
  { additionalProperties: false },
);

export type CartEdits = Static<typeof CartEditsSchema>;
export type EventEdits = Static<typeof EventEditsSchema>;
export type TripEdits = Static<typeof TripEditsSchema>;
export type PlanEdits = { event?: EventEdits; trip?: TripEdits };
export type WorkspaceEdits = PlanEdits & { cart?: CartEdits };

const EDIT_SECTIONS = { cart: CartEditsSchema, event: EventEditsSchema, trip: TripEditsSchema } as const;

export function parseWorkspaceEdits(v: unknown): WorkspaceEdits | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(EDIT_SECTIONS)) {
    const raw = (v as Record<string, unknown>)[key];
    if (!raw || typeof raw !== "object") continue;
    const section = Value.Clean(schema, structuredClone(raw));
    if (Value.Check(schema, section) && Object.keys(section as object).length) out[key] = section;
  }
  return Object.keys(out).length ? (out as WorkspaceEdits) : null;
}

export const ENTITY_SCHEMAS = {
  cart: CartEntitySchema,
  trip: TripEntitySchema,
  event: EventEntitySchema,
  shortlist: ShortlistEntitySchema,
} as const;

export type EntityKind = keyof typeof ENTITY_SCHEMAS;
export const ENTITY_KINDS = Object.keys(ENTITY_SCHEMAS) as EntityKind[];
export const PLAN_KINDS = ["event", "trip", "shortlist"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export type CartEntity = Static<typeof CartEntitySchema>;
export type TripEntity = Static<typeof TripEntitySchema>;
export type EventEntity = Static<typeof EventEntitySchema>;
export type ShortlistEntity = Static<typeof ShortlistEntitySchema>;

export const isEntityKind = (k: unknown): k is EntityKind => typeof k === "string" && k in ENTITY_SCHEMAS;
export const isPlanKind = (k: unknown): k is PlanKind => typeof k === "string" && (PLAN_KINDS as readonly string[]).includes(k);

export function validateEntity(kind: EntityKind, value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const schema: TSchema = ENTITY_SCHEMAS[kind];
  const errors = [...new Set([...Value.Errors(schema, value)].map((e) => `${e.instancePath || "/"}: ${e.message}`))];
  return errors.length ? { ok: false, errors } : { ok: true };
}

export type PatchOp = { op: "add" | "replace" | "remove"; path: string; value?: unknown };

const unescape = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

function parsePointer(path: string): string[] | null {
  if (path === "") return [];
  return path.startsWith("/") ? path.slice(1).split("/").map(unescape) : null;
}

type Container = Record<string, unknown> | unknown[];
const isContainer = (v: unknown): v is Container => v !== null && typeof v === "object";

export function applyPatch(doc: unknown, ops: PatchOp[]): { ok: true; value: unknown } | { ok: false; error: string } {
  let root = structuredClone(doc) as unknown;
  for (const [n, op] of ops.entries()) {
    const label = `op ${n} (${op.op} ${op.path})`;
    if (!["add", "replace", "remove"].includes(op.op)) return { ok: false, error: `${label}: op must be add, replace or remove` };
    if (op.op !== "remove" && op.value === undefined) return { ok: false, error: `${label}: value is required` };
    const keys = parsePointer(op.path);
    if (!keys) return { ok: false, error: `${label}: path must be a JSON pointer starting with /` };
    if (!keys.length) {
      if (op.op === "remove") return { ok: false, error: `${label}: cannot remove the whole entity` };
      root = structuredClone(op.value);
      continue;
    }
    if (keys.some((k) => FORBIDDEN.has(k))) return { ok: false, error: `${label}: forbidden key` };
    let parent: unknown = root;
    for (const k of keys.slice(0, -1)) {
      parent = isContainer(parent) ? (parent as Record<string, unknown>)[k] : undefined;
      if (!isContainer(parent)) return { ok: false, error: `${label}: path does not exist` };
    }
    if (!isContainer(parent)) return { ok: false, error: `${label}: path does not exist` };
    const last = keys[keys.length - 1];
    if (Array.isArray(parent)) {
      const at = last === "-" ? parent.length : Number(last);
      if (!Number.isInteger(at) || at < 0 || at > parent.length) return { ok: false, error: `${label}: bad array index` };
      if (op.op === "add") parent.splice(at, 0, structuredClone(op.value));
      else if (at >= parent.length) return { ok: false, error: `${label}: index out of range` };
      else if (op.op === "replace") parent[at] = structuredClone(op.value);
      else parent.splice(at, 1);
    } else {
      if (op.op !== "add" && !Object.hasOwn(parent, last)) return { ok: false, error: `${label}: path does not exist` };
      if (op.op === "remove") delete parent[last];
      else parent[last] = structuredClone(op.value);
    }
  }
  return { ok: true, value: root };
}

export function safeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
