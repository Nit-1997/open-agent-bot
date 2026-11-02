import { type CartEdits, type EntityKind, type PlanEdits, validateEntity, type WorkspaceEdits } from "../../../shared/workspace.js";
import { clip, oneLine } from "./summary.js";
import type { WorkspaceStore } from "./store.js";

async function patchLatest(store: WorkspaceStore, kind: EntityKind, fields: object): Promise<boolean> {
  const latest = (await store.list(kind)).at(-1);
  if (!latest) return false;
  const value = { ...(latest.value as object), ...fields };
  if (!validateEntity(kind, value).ok) return false;
  await store.put(kind, latest.id, value, latest.version);
  return true;
}

export async function applyEntityEdits(store: WorkspaceStore, edits: PlanEdits): Promise<PlanEdits> {
  const missed: PlanEdits = {};
  if (edits.event && !(await patchLatest(store, "event", edits.event))) missed.event = edits.event;
  if (edits.trip && !(await patchLatest(store, "trip", edits.trip))) missed.trip = edits.trip;
  return missed;
}

function cartChanges(e: CartEdits): string[] {
  return [
    ...Object.entries(e.qty ?? {}).map(([q, n]) => `${q} ×${n}`),
    ...(e.removed ?? []).map((q) => `removed ${q}`),
    ...Object.entries(e.picks ?? {}).flatMap(([store, chosen]) =>
      Object.entries(chosen).map(([q, title]) => `${store} ${q} → ${JSON.stringify(title)}`),
    ),
  ];
}

const fields = (o: object) =>
  Object.entries(o)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");

export function unappliedNote(edits: WorkspaceEdits): string | undefined {
  const changes = [
    ...(edits.cart ? cartChanges(edits.cart) : []),
    ...(edits.event ? [`${fields(edits.event)} on the event card`] : []),
    ...(edits.trip ? [`${fields(edits.trip)} on the trip card`] : []),
  ].map(oneLine);
  if (!changes.length) return undefined;
  const list = clip(changes.join("; "));
  const asks = [
    ...(edits.cart ? ["If the user wants that cart, search again with these changes."] : []),
    ...(edits.event || edits.trip ? ["If the user wants that plan, set it again with these changes."] : []),
  ];
  return `<unapplied_edits>\nThe user changed a card from earlier in this chat, but this session doesn't hold it, so nothing was applied: ${list}. ${asks.join(" ")} Don't say the change was saved.\n</unapplied_edits>`;
}
