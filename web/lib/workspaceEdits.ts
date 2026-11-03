import type { CartEdits, PlanEdits, WorkspaceEdits } from "@oab/shared/workspace";

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

export const workspaceContextValue = (e: WorkspaceEdits) => (hasEdits(e) ? JSON.stringify(e) : "");
