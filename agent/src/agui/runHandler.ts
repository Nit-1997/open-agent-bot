import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type Message, type RunAgentInput } from "@ag-ui/core";
import type { UserContext, UserProfile, Viewport } from "../prompt/systemPrompt.js";
import type { HistoryMessage, SessionEntry, SessionStore } from "../session/sessionStore.js";
import type { CartEdits } from "../shop/cart.js";
import { applyEntityEdits, parseCartEdits, parseWorkspaceEdits, type WorkspaceEdits } from "../workspace/edits.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { createTranslator, type PiEvent } from "./translate.js";

export const EMPTY_REPLY_NUDGE =
  "Your reply so far shows me no answer. Answer my previous message now, in full, from what the tools already returned, without searching again.";

function messageText(m: Message): string {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p?.type === "text" ? p.text : "")).join("");
  return "";
}

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

function readProfile(v: unknown): UserProfile | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const p = v as Record<string, unknown>;
  const interests = Array.isArray(p.interests)
    ? p.interests.map((i) => clip(i, 40)).filter((i): i is string => !!i).slice(0, 12)
    : [];
  const profile: UserProfile = {
    ...(clip(p.name, 80) && { name: clip(p.name, 80) }),
    ...(clip(p.home, 200) && { home: clip(p.home, 200) }),
    ...(interests.length && { interests }),
    ...(clip(p.notes, 1000) && { notes: clip(p.notes, 1000) }),
  };
  return Object.keys(profile).length ? profile : undefined;
}

function readViewport(v: unknown): Viewport | undefined {
  if (!v || typeof v !== "object") return undefined;
  const { width, height } = v as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 200 && n <= 10000;
  return ok(width) && ok(height) ? { width: Math.round(width), height: Math.round(height) } : undefined;
}

export function readUserContext(input: RunAgentInput): UserContext | null {
  const item = input.context?.find((c) => c.description === "user_context");
  if (!item) return null;
  try {
    const v = typeof item.value === "string" ? JSON.parse(item.value) : item.value;
    if (v && typeof v.timeZone === "string" && typeof v.locale === "string" && typeof v.localTime === "string") {
      const model = clip(v.model, 100);
      const profile = readProfile(v.profile);
      const viewport = readViewport(v.viewport);
      return { timeZone: v.timeZone, locale: v.locale, localTime: v.localTime, ...(model && { model }), ...(profile && { profile }), ...(viewport && { viewport }) };
    }
  } catch {}
  return null;
}

function contextValue(input: RunAgentInput, description: string): unknown {
  const item = input.context?.find((c) => c.description === description);
  if (!item?.value) return undefined;
  try {
    return typeof item.value === "string" ? JSON.parse(item.value) : item.value;
  } catch {
    return undefined;
  }
}

export function readCartEdits(input: RunAgentInput): CartEdits | null {
  return parseCartEdits(contextValue(input, "cart_edits")) ?? null;
}

export function readWorkspaceEdits(input: RunAgentInput): WorkspaceEdits | null {
  return parseWorkspaceEdits(contextValue(input, "workspace_edits"));
}

const HISTORY_LIMIT = 40;
const HISTORY_CLIP = 4000;

export function restoreHistory(messages: Message[]): HistoryMessage[] {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const turns = messages.slice(0, Math.max(lastUser, 0)).flatMap((m): HistoryMessage[] => {
    const text = messageText(m).trim().slice(0, HISTORY_CLIP);
    return (m.role === "user" || m.role === "assistant") && text ? [{ role: m.role, text }] : [];
  });
  const merged = turns.reduce<HistoryMessage[]>((out, t) => {
    const prev = out.at(-1);
    if (prev?.role === t.role) prev.text = `${prev.text}\n\n${t.text}`;
    else out.push({ ...t });
    return out;
  }, []);
  const recent = merged.slice(-HISTORY_LIMIT);
  return recent[0]?.role === "assistant" ? recent.slice(1) : recent;
}

export type RunStats = {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  costUsd: number;
  jevCalls: number;
  jevCostUsd: number;
  toolCalls: number;
  llmTurns: number;
  durationMs: number;
  skills: string[];
};

type Usage = { input?: number; output?: number; cacheRead?: number; cost?: { total?: number } };

function createStatsCollector(now: () => number = Date.now) {
  const startedAt = now();
  const totals = { inputTokens: 0, outputTokens: 0, cacheRead: 0, costUsd: 0, toolCalls: 0, llmTurns: 0 };
  const script = { calls: 0, costUsd: 0 };
  const skills: string[] = [];
  return {
    usage(u: Usage) {
      totals.inputTokens += u.input ?? 0;
      totals.outputTokens += u.output ?? 0;
      totals.cacheRead += u.cacheRead ?? 0;
      totals.costUsd += u.cost?.total ?? 0;
      totals.llmTurns++;
    },
    scriptCost(u: Usage) {
      script.costUsd += u.cost?.total ?? 0;
    },
    scriptCalls(result: unknown) {
      const calls = (result as { details?: { calls?: { name?: string }[] } } | undefined)?.details?.calls;
      script.calls += (calls ?? []).filter((c) => c.name?.startsWith("models.")).length;
    },
    toolStart(name: string, args: unknown) {
      totals.toolCalls++;
      const skill = (args as { name?: unknown } | undefined)?.name;
      if (name === "load_skill" && typeof skill === "string" && !skills.includes(skill)) skills.push(skill);
    },
    snapshot(turn?: { jevCalls: number; jevCostUsd: number }): RunStats {
      return { ...totals, jevCalls: (turn?.jevCalls ?? 0) + script.calls, jevCostUsd: (turn?.jevCostUsd ?? 0) + script.costUsd, durationMs: now() - startedAt, skills: [...skills] };
    },
  };
}

function runError(code: string, message: string): BaseEvent {
  return { type: EventType.RUN_ERROR, code, message } as BaseEvent;
}

export type RunOptions = { workspace?: WorkspaceStore };

export async function* handleRun(input: RunAgentInput, store: SessionStore, signal: AbortSignal, opts: RunOptions = {}): AsyncIterable<BaseEvent> {
  const { threadId, runId } = input;
  yield { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent;

  const userMessages = input.messages.filter((m) => m.role === "user");
  const last = userMessages.at(-1);
  if (!last) {
    yield runError("BAD_INPUT", "No user message in run input.");
    return;
  }

  const restoring = !store.get(threadId) && userMessages.length > 1;

  const userContext = readUserContext(input);
  console.log(`[run] thread=${threadId} context=${JSON.stringify(userContext)} prompt=${JSON.stringify(messageText(last).slice(0, 200))}`);

  const stats = createStatsCollector();
  let made: { entry: SessionEntry } | { error: unknown };
  try {
    made = { entry: await store.getOrCreate(threadId, userContext, restoring ? restoreHistory(input.messages) : undefined) };
  } catch (error) {
    made = { error };
  }

  if ("error" in made) {
    yield runError("MODEL_ERROR", made.error instanceof Error ? made.error.message : String(made.error));
    return;
  }
  const entry: SessionEntry = made.entry;
  if (entry.busy) {
    yield runError("THREAD_BUSY", "Still working on the last message.");
    return;
  }
  if (signal.aborted) return;
  entry.busy = true;
  entry.onRunStart?.();

  const queue: BaseEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let modelError: string | undefined;
  const push = (events: BaseEvent[]) => {
    if (!events.length) return;
    queue.push(...events);
    wake?.();
  };

  if (userContext?.model && entry.setModel) {
    try {
      await entry.setModel(userContext.model);
    } catch (err) {
      entry.busy = false;
      yield runError("MODEL_ERROR", err instanceof Error ? err.message : String(err));
      return;
    }
  }

  const wsEdits = opts.workspace ? readWorkspaceEdits(input) : null;
  const edits = wsEdits ? wsEdits.cart : readCartEdits(input);
  if (edits) entry.cart?.applyEdits(edits);
  if (wsEdits && opts.workspace) applyEntityEdits(opts.workspace, threadId, wsEdits);
  entry.evidence?.add(messageText(last));
  if (restoring) for (const m of restoreHistory(input.messages)) entry.evidence?.add(m.text);
  if (opts.workspace) entry.evidence?.add(opts.workspace.summary(threadId));
  const statsEvent = (): BaseEvent => {
    const turn = entry.turnStats?.();
    return { type: EventType.CUSTOM, name: "run_stats", value: stats.snapshot(turn) } as BaseEvent;
  };

  const translator = createTranslator({ newId: randomUUID, evidence: entry.evidence });
  const unsubscribe = entry.session.subscribe((e: PiEvent) => {
    if (e.type === "tool_execution_start") stats.toolStart(e.toolName, e.args);
    if (e.type === "tool_execution_start") console.log(`[run] thread=${threadId} tool=${e.toolName} args=${JSON.stringify(e.args).slice(0, 300)}`);
    if (e.type === "tool_execution_end" && e.toolName === "codemode") stats.scriptCalls(e.result);
    if (e.type === "tool_execution_end") console.log(`[run] thread=${threadId} tool=${e.toolName} error=${e.isError} result=${JSON.stringify(e.result?.content?.[0]?.text ?? "").slice(0, 200)}`);
    if (e.type === "message_end") {
      const m = e.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: Usage & { input: number; output: number; cacheRead: number } };
      if (m.role === "assistant" && m.usage) stats.usage(m.usage);
      if (m.role === "assistant" && m.usage) {
        const parts = (e.message as { content?: { type: string; text?: string; thinking?: string }[] }).content ?? [];
        const chars = (type: string) => parts.filter((c) => c.type === type).reduce((n, c) => n + (c.text ?? c.thinking ?? "").length, 0);
        console.log(`[run] thread=${threadId} usage in=${m.usage.input} out=${m.usage.output} cacheRead=${m.usage.cacheRead} text=${chars("text")} thinking=${chars("thinking")}`);
      }
      if (m.role === "toolResult" && m.usage) stats.scriptCost(m.usage);
      if (m.role === "assistant" && m.stopReason === "error") modelError = m.errorMessage ?? "The model returned an error.";
    }
    push(translator.translate(e));
  });

  const unwatch = entry.frames?.subscribe((value) => push([{ type: EventType.CUSTOM, name: "browser_frame", value } as BaseEvent]));

  const onAbort = () => {
    void entry.session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  let running: Promise<void> = Promise.resolve();
  const start = (text: string) => {
    done = false;
    running = entry.session
      .prompt(text)
      .catch((err: unknown) => {
        modelError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        done = true;
        wake?.();
      });
  };
  async function* drain(): AsyncGenerator<BaseEvent> {
    while (true) {
      while (queue.length) yield queue.shift()!;
      if (done) break;
      await new Promise<void>((r) => (wake = r));
      wake = undefined;
    }
    await running;
  }

  start(messageText(last));
  try {
    yield* drain();
    if (!modelError && !signal.aborted && !translator.answered()) {
      console.log(`[run] thread=${threadId} empty reply, asking for the answer`);
      start(EMPTY_REPLY_NUDGE);
      yield* drain();
    }
    for (const e of translator.finish()) yield e;
    if (signal.aborted) return;
    console.log(`[run] thread=${threadId} done error=${modelError ?? "none"}`);
    yield statsEvent();
    if (modelError) yield runError("MODEL_ERROR", modelError);
    else yield { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent;
  } finally {
    if (!done) await entry.session.abort().catch(() => {});
    await running;
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
    unwatch?.();
    entry.busy = false;
    store.touch(threadId);
  }
}
