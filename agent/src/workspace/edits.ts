import { type EntityKind, validateEntity, type WorkspaceEdits } from "../../../shared/workspace.js";
import type { WorkspaceStore } from "./store.js";

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
