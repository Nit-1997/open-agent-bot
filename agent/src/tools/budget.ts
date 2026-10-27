import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { fail } from "./result.js";

export class ToolBudget {
  private used = new Map<string, number>();

  constructor(private readonly limits: Record<string, number>) {}

  take(group: string): { ok: true } | { ok: false; limit: number } {
    const limit = this.limits[group] ?? Number.POSITIVE_INFINITY;
    const n = this.used.get(group) ?? 0;
    if (n >= limit) return { ok: false, limit };
    this.used.set(group, n + 1);
    return { ok: true };
  }

  reset(): void {
    this.used.clear();
  }
}

export function withBudget<T extends ToolDefinition<any, any, any>>(tool: T, budget: ToolBudget, group: string): T {
  const wrapped: ToolDefinition<any, any, any> = {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const r = budget.take(group);
      if (!r.ok) {
        return fail(
          `Budget for ${tool.name} in this reply is used up (${r.limit}). Answer now with what you already have, and offer to look up more if needed.`,
        );
      }
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
  return wrapped as T;
}
