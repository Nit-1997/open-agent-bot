import { type EntityKind, validateEntity, type WorkspaceEdits } from "../../../shared/workspace.js";
import type { WorkspaceStore } from "./store.js";

async function patchLatest(store: WorkspaceStore, kind: EntityKind, fields: object): Promise<void> {
  const latest = (await store.list(kind)).at(-1);
  if (!latest) return;
  const value = { ...(latest.value as object), ...fields };
  if (validateEntity(kind, value).ok) await store.put(kind, latest.id, value, latest.version);
}

export async function applyEntityEdits(store: WorkspaceStore, edits: WorkspaceEdits): Promise<void> {
  if (edits.event) await patchLatest(store, "event", edits.event);
  if (edits.trip) await patchLatest(store, "trip", edits.trip);
}
