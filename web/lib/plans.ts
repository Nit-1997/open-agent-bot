import type { PlanSummary, PlansResponse } from "@shared/lists";
import type { Cart, Plan } from "@shared/widgets";
import type { EntityKind } from "@shared/workspace";
import { readApi } from "@/lib/api";

export type PlanDetailResponse = { plan: PlanSummary; widget: Plan | Cart };

export const plansApi = {
  page: async (page: number, kind: EntityKind | null, signal?: AbortSignal) => {
    const q = new URLSearchParams({ page: String(page), ...(kind && { kind }) });
    return readApi<PlansResponse>(await fetch(`/api/plans?${q}`, { cache: "no-store", signal }));
  },
  get: async (chatId: string, kind: EntityKind, key: string, signal?: AbortSignal) =>
    readApi<PlanDetailResponse>(await fetch(`/api/plans/${chatId}/${kind}/${key}`, { cache: "no-store", signal })),
};
