import type { CartEdits } from "@/components/widgets/CartCard";

export type EventEdits = { guests?: number; date?: string; budget?: number };
export type TripEdits = { start?: string; end?: string; travelers?: number };
export type PlanEdits = { event?: EventEdits; trip?: TripEdits };
export type WorkspaceEdits = PlanEdits & { cart?: CartEdits };

const isEmpty = (o: object | undefined) => !o || Object.keys(o).length === 0;

export const withCartEdits = (prev: WorkspaceEdits, cart: CartEdits): WorkspaceEdits => ({ ...prev, cart });

export function withPlanEdits(prev: WorkspaceEdits, plan: PlanEdits): WorkspaceEdits {
  const next: WorkspaceEdits = { ...prev };
  for (const kind of ["event", "trip"] as const) {
    if (!(kind in plan)) continue;
    if (isEmpty(plan[kind])) delete next[kind];
    else Object.assign(next, { [kind]: plan[kind] });
  }
  return next;
}

export const hasEdits = (e: WorkspaceEdits) => Object.keys(e).length > 0;

export const cartContextValue = (e: WorkspaceEdits) => (e.cart ? JSON.stringify(e.cart) : "");
export const workspaceContextValue = (e: WorkspaceEdits) => (hasEdits(e) ? JSON.stringify(e) : "");
