import type { Assertion, AssertionResult, TurnRecord } from "./types.js";

const str = (a: Assertion, key: string): string => {
  const v = a[key];
  if (typeof v !== "string" || !v) throw new Error(`${a.type} needs "${key}"`);
  return v;
};

const num = (a: Assertion, key: string): number => {
  const v = a[key];
  if (typeof v !== "number") throw new Error(`${a.type} needs numeric "${key}"`);
  return v;
};

const matcher = (pattern: string) => new RegExp(pattern, "i");

export function labelOf(a: Assertion): string {
  const { type, turn, ...rest } = a;
  const parts = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === "string" ? v : Array.isArray(v) ? `${v.length} patterns` : JSON.stringify(v)}`);
  return `${type}${parts.length ? `(${parts.join(", ")})` : ""}${turn ? ` @turn ${turn}` : ""}`;
}

function check(a: Assertion, turns: TurnRecord[]): { ok: boolean; detail: string } {
  const tools = turns.flatMap((t) => t.tools);
  const widgets = turns.flatMap((t) => t.widgets);
  switch (a.type) {
    case "must_call": {
      const tool = str(a, "tool");
      const n = tools.filter((t) => t.name === tool).length;
      return { ok: n > 0, detail: `${tool} called ${n}x` };
    }
    case "must_not_call": {
      const tool = str(a, "tool");
      const n = tools.filter((t) => t.name === tool).length;
      return { ok: n === 0, detail: `${tool} called ${n}x` };
    }
    case "max_tool_calls": {
      const max = num(a, "n");
      return { ok: tools.length <= max, detail: `${tools.length} calls, max ${max}` };
    }
    case "widget_present": {
      const kind = str(a, "kind");
      const n = widgets.filter((w) => w.kind === kind).length;
      return { ok: n > 0, detail: `${kind} shown ${n}x; saw [${[...new Set(widgets.map((w) => w.kind))].join(", ")}]` };
    }
    case "max_unverified_claims": {
      const max = num(a, "n");
      const n = turns.reduce((s, t) => s + t.unverifiedClaims, 0);
      return { ok: n <= max, detail: `${n} unverified, max ${max}` };
    }
    case "banned_phrases": {
      const patterns = a.patterns;
      if (!Array.isArray(patterns) || !patterns.every((p) => typeof p === "string")) throw new Error("banned_phrases needs patterns[]");
      const text = turns.map((t) => t.text).join("\n");
      const hit = (patterns as string[]).find((p) => matcher(p).test(text));
      return { ok: !hit, detail: hit ? `matched /${hit}/: "${text.match(matcher(hit))?.[0]}"` : "none matched" };
    }
    case "max_duration_s": {
      const max = num(a, "n");
      const s = turns.reduce((sum, t) => sum + t.durationMs, 0) / 1000;
      return { ok: s <= max, detail: `${s.toFixed(1)}s, max ${max}s` };
    }
    case "text_matches": {
      const p = str(a, "pattern");
      return { ok: turns.some((t) => matcher(p).test(t.text)), detail: `/${p}/ on reply text` };
    }
    case "tool_arg_matches": {
      const tool = str(a, "tool");
      const p = str(a, "pattern");
      const calls = tools.filter((t) => t.name === tool);
      return { ok: calls.some((t) => matcher(p).test(JSON.stringify(t.args ?? {}))), detail: `/${p}/ on ${calls.length} ${tool} call(s)` };
    }
    case "tool_result_matches": {
      const tool = str(a, "tool");
      const p = str(a, "pattern");
      const calls = tools.filter((t) => t.name === tool);
      return { ok: calls.some((t) => matcher(p).test(t.result)), detail: `/${p}/ on ${calls.length} ${tool} result(s)` };
    }
    case "widget_matches": {
      const kind = str(a, "kind");
      const p = str(a, "pattern");
      const ws = widgets.filter((w) => w.kind === kind);
      return { ok: ws.some((w) => matcher(p).test(w.json)), detail: `/${p}/ on ${ws.length} ${kind} widget(s)` };
    }
    default:
      throw new Error(`unknown assertion type "${a.type}"`);
  }
}

export function evaluate(a: Assertion, turns: TurnRecord[]): AssertionResult {
  const label = labelOf(a);
  const scoped = a.turn === undefined ? turns : turns.filter((_, i) => i === a.turn! - 1);
  try {
    return { label, ...check(a, scoped) };
  } catch (err) {
    return { label, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export function evaluateAll(assertions: Assertion[], turns: TurnRecord[]): AssertionResult[] {
  return assertions.map((a) => evaluate(a, turns));
}
