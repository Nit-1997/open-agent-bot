import { type EntityKind, validateEntity } from "../../../shared/workspace.js";
import type { CartEdits } from "../shop/cart.js";
import type { WorkspaceStore } from "./store.js";

export type EventEdits = { guests?: number; date?: string; budget?: number };
export type TripEdits = { start?: string; end?: string; travelers?: number };
export type WorkspaceEdits = { cart?: CartEdits; event?: EventEdits; trip?: TripEdits };

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.round(v) : undefined);
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 40) : undefined);
const defined = <T extends object>(o: T): T | undefined => (Object.values(o).some((x) => x !== undefined) ? (Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T) : undefined);

export function parseCartEdits(v: unknown): CartEdits | undefined {
  const c = obj(v);
  if (!c) return undefined;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 50) : undefined);
  return {
    removed: strings(c.removed),
    qty: obj(c.qty) as Record<string, number> | undefined,
    picks: obj(c.picks) as Record<string, Record<string, string>> | undefined,
  };
}

export function parseWorkspaceEdits(v: unknown): WorkspaceEdits | null {
  const w = obj(v);
  if (!w) return null;
  const e = obj(w.event) ?? {};
  const t = obj(w.trip) ?? {};
  const cart = parseCartEdits(w.cart);
  const event = defined<EventEdits>({ guests: count(e.guests), date: date(e.date), budget: money(e.budget) });
  const trip = defined<TripEdits>({ start: date(t.start), end: date(t.end), travelers: count(t.travelers) });
  const out: WorkspaceEdits = { ...(cart && { cart }), ...(event && { event }), ...(trip && { trip }) };
  return Object.keys(out).length ? out : null;
}

function patchLatest(store: WorkspaceStore, thread: string, kind: EntityKind, fields: object): void {
  const latest = store.list(thread, kind).at(-1);
  if (!latest) return;
  const value = { ...(latest.value as object), ...fields };
  if (validateEntity(kind, value).ok) store.put(thread, kind, latest.id, value, latest.version);
}

export function applyEntityEdits(store: WorkspaceStore, thread: string, edits: WorkspaceEdits): void {
  if (edits.event) patchLatest(store, thread, "event", edits.event);
  if (edits.trip) patchLatest(store, thread, "trip", edits.trip);
}
