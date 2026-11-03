import { dedupeSources, hostOf, linksIn, searchResults, type Source, toSource } from "./sources";
import { RENDER_TOOLS, type StepArgs, type WorkflowStepEvent } from "./steps";

type ToolCall = { id: string; function: { name: string; arguments: string } };

export type ChatMessage =
  | { id: string; role: "user"; content: unknown }
  | { id: string; role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { id: string; role: "tool"; toolCallId: string; content: string }
  | { id: string; role: string; content?: unknown };

export type Step = { id: string; name: string; args: StepArgs; done: boolean; result?: string; sites: string[] };

export type TurnItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "widget"; id: string; widget: unknown }
  | { kind: "artifact"; id: string; title: string; result: string | undefined };

export type Turn = { id: string; user?: { id: string; text: string }; items: TurnItem[]; steps: Step[]; sources: Source[] };

function parseArgs(raw: string): StepArgs {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p?.type === "text" ? p.text : "")).join("");
  return "";
}

function itemFor(name: string, id: string, args: Record<string, unknown>, result: string | undefined): TurnItem | null {
  if (name === "show_widget") return { kind: "widget", id, widget: args.widget };
  if (name === "create_artifact") return { kind: "artifact", id, title: String(args.title ?? "Page"), result };
  if (name === "research")
    return { kind: "artifact", id, title: /artifact [\w-]{12} created: ([^\n]+)/.exec(result ?? "")?.[1] ?? "Report", result };
  return null;
}

function openedBy(name: string, args: Record<string, unknown>): Source[] {
  const urls =
    name === "fetch_page"
      ? [args.url]
      : name === "browse" && Array.isArray(args.actions)
        ? (args.actions as Array<{ op?: string; url?: string }>).filter((a) => a.op === "goto").map((a) => a.url)
        : [];
  return urls.map((u) => toSource(String(u ?? ""))).filter((s): s is Source => s !== null);
}

export function buildTurns(messages: readonly ChatMessage[]): Turn[] {
  const results = new Map<string, string>();
  for (const m of messages) if (m.role === "tool" && "toolCallId" in m) results.set(m.toolCallId, String(m.content ?? ""));

  const turns: Turn[] = [];
  let turn: Turn | undefined;
  const parts = new WeakMap<Turn, { cited: Source[]; opened: Source[]; searched: Source[] }>();
  const start = (id: string, user?: Turn["user"]) => {
    turn = { id, user, items: [], steps: [], sources: [] };
    parts.set(turn, { cited: [], opened: [], searched: [] });
    turns.push(turn);
    return turn;
  };

  for (const m of messages) {
    if (m.role === "user") {
      start(m.id, { id: m.id, text: textOf(m.content) });
      continue;
    }
    if (m.role !== "assistant") continue;
    const t = turn ?? start(m.id);
    const p = parts.get(t)!;
    const a = m as { id: string; content?: string; toolCalls?: ToolCall[] };
    const text = textOf(a.content);
    if (text.trim()) {
      t.items.push({ kind: "text", id: a.id, text });
      p.cited.push(...linksIn(text));
    }
    for (const c of a.toolCalls ?? []) {
      const name = c.function.name;
      const args = parseArgs(c.function.arguments);
      const result = results.get(c.id);
      const item = itemFor(name, c.id, args, result);
      if (item) t.items.push(item);
      if (RENDER_TOOLS.has(name)) continue;
      const found = name === "web_search" && result ? searchResults(result) : [];
      p.searched.push(...found);
      p.opened.push(...openedBy(name, args));
      t.steps.push({ id: c.id, name, args, done: result !== undefined, result, sites: [...new Set(found.map((s) => s.host))] });
    }
  }
  for (const t of turns) {
    const p = parts.get(t)!;
    t.sources = dedupeSources([p.cited, p.opened, p.searched]).filter((s) => hostOf(s.url));
  }
  return turns;
}

const PHASES: WorkflowStepEvent["phase"][] = ["research", "plan", "implement", "verify"];

export function withWorkflow(turns: Turn[], events: Record<string, WorkflowStepEvent[]>): Turn[] {
  return turns.map((t) => {
    const seen = events[t.id];
    const at = t.steps.findIndex((s) => s.name === "research");
    if (!seen?.length || at < 0) return t;
    const call = t.steps[at];
    const phases = PHASES.filter((p) => seen.some((e) => e.phase === p)).map((phase): Step => {
      const detail = seen.filter((e) => e.phase === phase && e.detail).at(-1)?.detail;
      const finished = call.done || seen.some((e) => e.phase === phase && e.status === "done");
      return { id: `${call.id}-${phase}`, name: "workflow_step", args: { phase, ...detail }, done: finished, sites: [] };
    });
    return { ...t, steps: [...t.steps.slice(0, at), ...phases, ...t.steps.slice(at + 1)] };
  });
}
