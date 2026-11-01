import type { PlanSummary } from "../../../shared/lists.js";
import type { Plan } from "../../../shared/widgets.js";
import { validateWidget } from "../../../shared/widgets.js";
import {
  type CartEntity,
  type EntityKind,
  type EventEntity,
  entityKey,
  isPlanKind,
  type ShortlistEntity,
  type TripEntity,
  validateEntity,
} from "../../../shared/workspace.js";
import type { ChatEntity } from "../db/types.js";
import { cartWidget } from "../render/cart.js";
import { entityDetail } from "../workspace/summary.js";

export const UNTITLED_CHAT = "Untitled chat";

function entityTitle(kind: EntityKind, value: unknown): string {
  switch (kind) {
    case "cart": {
      const c = value as CartEntity;
      const stores = c.scope.length ? c.scope : c.stores;
      return stores.length ? `Cart · ${stores.join(", ")}` : "Cart";
    }
    case "trip":
      return (value as TripEntity).destination;
    case "event":
      return (value as EventEntity).title;
    case "shortlist":
      return (value as ShortlistEntity).title;
  }
}

export function planSummary(e: ChatEntity, chatTitle: string | undefined): PlanSummary {
  const valid = validateEntity(e.kind, e.value).ok;
  return {
    chatId: e.chatId,
    chatTitle: chatTitle?.trim() || UNTITLED_CHAT,
    kind: e.kind,
    entityId: e.id,
    key: entityKey(e.id),
    title: valid ? entityTitle(e.kind, e.value) : `Saved ${e.kind}`,
    line: valid ? entityDetail(e) : "This plan can't be summarised.",
    version: e.version,
    updatedAt: new Date(e.updatedAt).toISOString(),
  };
}

export function planWidget(e: ChatEntity): ReturnType<typeof cartWidget> | Plan | null {
  if (!validateEntity(e.kind, e.value).ok) return null;
  if (e.kind === "cart") return cartWidget(e.value as CartEntity);
  if (!isPlanKind(e.kind)) return null;
  const r = validateWidget({ kind: "plan", entity: e.kind, id: e.id, version: e.version, value: e.value });
  return r.ok && r.value.kind === "plan" ? (r.value as Plan) : null;
}
