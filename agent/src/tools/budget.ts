import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { fail, type ToolResult } from "./result.js";

type Taken = { ok: true; nudge?: string; suffix?: string } | { ok: false; reason: string };

export interface Budget {
  take(group: string): Taken;
  reset(): void;
}

const ANSWER_NOW = "Answer now with what you already have, and offer to look up more if needed.";

export class ToolBudget implements Budget {
  private used = new Map<string, number>();

  constructor(private readonly limits: Record<string, number>) {}

  take(group: string): Taken {
    const limit = this.limits[group] ?? Number.POSITIVE_INFINITY;
    const n = this.used.get(group) ?? 0;
    if (n >= limit) return { ok: false, reason: `(${limit})` };
    this.used.set(group, n + 1);
    return { ok: true };
  }

  reset(): void {
    this.used.clear();
  }
}

export const DEFAULT_TURN_CALLS = 24;
export const DEFAULT_TURN_WALL_MS = 240_000;

export class TurnBudget implements Budget {
  private used = new Map<string, number>();
  private calls = 0;
  private started: number;
  private readonly total: number;
  private readonly wallMs: number;
  private readonly now: () => number;
  private readonly hard: Record<string, number>;

  constructor(
    private readonly soft: Record<string, number>,
    opts: { total?: number; wallMs?: number; now?: () => number; hard?: Record<string, number> } = {},
  ) {
    this.hard = opts.hard ?? {};
    this.total = opts.total ?? DEFAULT_TURN_CALLS;
    this.wallMs = opts.wallMs ?? DEFAULT_TURN_WALL_MS;
    this.now = opts.now ?? Date.now;
    this.started = this.now();
  }

  take(group: string): Taken {
    if (this.now() - this.started >= this.wallMs) return { ok: false, reason: `(${Math.round(this.wallMs / 1000)}s)` };
    if (this.calls >= this.total) return { ok: false, reason: `(${this.total} calls)` };
    const n = (this.used.get(group) ?? 0) + 1;
    if (this.hard[group] != null && n > this.hard[group]) return { ok: false, reason: `(${this.hard[group]})` };
    this.calls++;
    this.used.set(group, n);
    const limit = this.soft[group];
    const nudge = limit != null && n > limit ? `Note: this is ${group} call ${n} in this reply, more than usually needed. Wrap up with what you have unless something essential is missing.` : undefined;
    return { ok: true, nudge, suffix: `(budget: ${this.calls} of ${this.total} calls used)` };
  }

  reset(): void {
    this.used.clear();
    this.calls = 0;
    this.started = this.now();
  }
}

function annotate(result: ToolResult, lines: string[]): ToolResult {
  if (!lines.length) return result;
  const extra = lines.join("\n");
  const content = [...result.content];
  const last = content.length - 1;
  if (last >= 0 && content[last].type === "text") content[last] = { ...content[last], text: `${content[last].text}\n\n${extra}` };
  else content.push({ type: "text", text: extra });
  return { ...result, content };
}

export function withBudget<T extends ToolDefinition<any, any, any>>(tool: T, budget: Budget, group: string, exhausted?: string): T {
  const wrapped: ToolDefinition<any, any, any> = {
    ...tool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const r = budget.take(group);
      if (!r.ok) return fail(exhausted ?? `Budget for ${tool.name} in this reply is used up ${r.reason}. ${ANSWER_NOW}`);
      const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
      return annotate(result as ToolResult, [r.nudge, r.suffix].filter((x): x is string => !!x));
    },
  };
  return wrapped as T;
}
