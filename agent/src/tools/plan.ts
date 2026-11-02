import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validateWidget } from "../../../shared/widgets.js";
import {
  applyPatch,
  ENTITY_KINDS,
  type EntityKind,
  isEntityKind,
  isPlanKind,
  type PatchOp,
  validateEntity,
} from "../../../shared/workspace.js";
import { VersionConflict, WorkspaceFull } from "../workspace/conflict.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { fail, ok, type ToolResult } from "./result.js";

const DEFAULT_ID = "main";

const DESCRIPTION =
  'This chat\'s plans for the current session: events/parties, trips and shortlists (plus the shopping cart, read-only here). Record every trip, event or shortlist you plan with action "set" (kind event: {title, date?, guests, budget?, currency?, location?, theme?, menu?, timeline?, notes?}; trip: {destination, start, end, travelers, budget?, stays, days}; shortlist: {title, items}). The workspace note at the top of each turn lists the current plans; they last for this session only and aren\'t saved anywhere else. For follow-ups that change a detail ("make it 16 kids", "move it to the 20th") use action "patch" with ops like [{"op":"replace","path":"/guests","value":16}] (op: add, replace or remove; JSON-pointer path), then call shop with only the items whose quantities changed. Never rebuild the plan or re-search unchanged items. "get" reads an entity back. set and patch show a plan card.';

const looseJson = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

function readOps(v: unknown): PatchOp[] | string {
  const raw = looseJson(v);
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : null;
  if (!list?.length) return "patch needs ops: [{op, path, value}]";
  const ops: PatchOp[] = [];
  for (const o of list) {
    const { op, path, value } = (o ?? {}) as Record<string, unknown>;
    if (op !== "add" && op !== "replace" && op !== "remove") return `op must be add, replace or remove, got ${JSON.stringify(op)}`;
    if (typeof path !== "string") return "every op needs a string path";
    ops.push({ op, path, ...(value !== undefined && { value }) });
  }
  return ops;
}

function planResult(kind: EntityKind, id: string, version: number, value: unknown, verb: string): ToolResult {
  const text = `${verb} ${kind} "${id}" (version ${version}): ${JSON.stringify(value)}`;
  if (!isPlanKind(kind)) return ok(text);
  const widget = validateWidget({ kind: "plan", entity: kind, id, version, value });
  return ok(text, widget.ok ? { widget: widget.value } : {});
}

type Target = { store: WorkspaceStore; kind: EntityKind; id: string };

const describe = (kind: EntityKind, id: string, version: number, value: unknown) =>
  `${kind} "${id}" (version ${version}): ${JSON.stringify(value)}`;

async function getEntity({ store, kind, id }: Target, byId: boolean): Promise<ToolResult> {
  if (byId) {
    const found = await store.get(kind, id);
    return found ? ok(describe(kind, id, found.version, found.value)) : fail(`No ${kind} "${id}" in this session.`);
  }
  const all = await store.list(kind);
  return all.length ? ok(all.map((e) => describe(kind, e.id, e.version, e.value)).join("\n")) : fail(`No ${kind} in this session yet.`);
}

async function setEntity({ store, kind, id }: Target, raw: unknown): Promise<ToolResult> {
  const value = looseJson(raw);
  const valid = validateEntity(kind, value);
  if (!valid.ok) return fail(`Invalid ${kind}: ${valid.errors.join("; ")}`);
  try {
    return planResult(kind, id, await store.put(kind, id, value), value, "Set");
  } catch (err) {
    if (err instanceof WorkspaceFull) return fail(err.message);
    throw err;
  }
}

async function patchEntity({ store, kind, id }: Target, rawOps: unknown): Promise<ToolResult> {
  const current = await store.get(kind, id);
  if (!current) return fail(`No ${kind} "${id}" in this session yet; use set first.`);
  const ops = readOps(rawOps);
  if (typeof ops === "string") return fail(ops);
  const patched = applyPatch(current.value, ops);
  if (!patched.ok) return fail(`Patch failed: ${patched.error}`);
  const valid = validateEntity(kind, patched.value);
  if (!valid.ok) return fail(`Patch makes the ${kind} invalid: ${valid.errors.join("; ")}`);
  try {
    return planResult(kind, id, await store.put(kind, id, patched.value, current.version), patched.value, "Updated");
  } catch (err) {
    if (err instanceof VersionConflict) return fail(`${kind} "${id}" changed meanwhile; get it and patch again.`);
    throw err;
  }
}

export function planTool(deps: { store: WorkspaceStore }) {
  const { store } = deps;
  return defineTool({
    name: "plan",
    label: "Plan",
    description: DESCRIPTION,
    parameters: Type.Object({
      action: Type.Enum(["get", "set", "patch"]),
      kind: Type.Enum(ENTITY_KINDS),
      id: Type.Optional(Type.String({ maxLength: 64, description: `entity id, default "${DEFAULT_ID}"` })),
      value: Type.Optional(Type.Any({ description: "set: the whole entity" })),
      ops: Type.Optional(Type.Any({ description: "patch: [{op: add|replace|remove, path: JSON pointer, value}]" })),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (!isEntityKind(params.kind)) return fail(`kind must be one of ${ENTITY_KINDS.join(", ")}`);
      const at: Target = { store, kind: params.kind, id: params.id?.trim() || DEFAULT_ID };
      if (params.action === "get") return getEntity(at, !!params.id);
      if (at.kind === "cart") return fail("The cart is changed with the shop tool, not plan.");
      return params.action === "set" ? setEntity(at, params.value) : patchEntity(at, params.ops);
    },
  });
}
