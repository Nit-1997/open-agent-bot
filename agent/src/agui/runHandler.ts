import { randomUUID } from "node:crypto";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/core";
import type { UserContext } from "../prompt/userContext.js";
import type { HistoryMessage, SessionEntry, SessionStore } from "../session/sessionStore.js";
import { log } from "../lib/log.js";
import { applyEntityEdits } from "../workspace/edits.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { custom, runError, runFinished, runStarted } from "./events.js";
import { messageText, readUserContext, readWorkspaceEdits, restoreHistory } from "./input.js";
import { createStatsCollector, type StatsCollector, type Usage } from "./stats.js";
import { createTranslator, type PiEvent } from "./translate.js";

export const EMPTY_REPLY_NUDGE =
  "Your reply so far shows me no answer. Answer my previous message now, in full, from what the tools already returned, without searching again.";

export type RunOptions = { workspace?: WorkspaceStore };

type AssistantEnd = {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: Usage & { input: number; output: number; cacheRead: number };
  content?: { type: string; text?: string; thinking?: string }[];
};

function observe(stats: StatsCollector, e: PiEvent): string | undefined {
  if (e.type === "tool_execution_start") stats.toolStart(e.toolName, e.args);
  if (e.type === "tool_execution_end" && e.toolName === "codemode") stats.scriptCalls(e.result);
  if (e.type !== "message_end") return undefined;
  const m = e.message as AssistantEnd;
  if (m.role === "toolResult" && m.usage) stats.scriptCost(m.usage);
  if (m.role !== "assistant") return undefined;
  if (m.usage) stats.usage(m.usage);
  return m.stopReason === "error" ? (m.errorMessage ?? "The model returned an error.") : undefined;
}

function logEvent(threadId: string, e: PiEvent): void {
  if (e.type === "tool_execution_start") {
    log.debug(`[run] thread=${threadId} tool=${e.toolName} args=${JSON.stringify(e.args).slice(0, 300)}`);
  } else if (e.type === "tool_execution_end") {
    const result = JSON.stringify(e.result?.content?.[0]?.text ?? "").slice(0, 200);
    log.debug(`[run] thread=${threadId} tool=${e.toolName} error=${e.isError} result=${result}`);
  } else if (e.type === "message_end") {
    const m = e.message as AssistantEnd;
    if (m.role !== "assistant" || !m.usage) return;
    const chars = (type: string) =>
      (m.content ?? []).filter((c) => c.type === type).reduce((n, c) => n + (c.text ?? c.thinking ?? "").length, 0);
    log.info(
      `[run] thread=${threadId} usage in=${m.usage.input} out=${m.usage.output} cacheRead=${m.usage.cacheRead} text=${chars("text")} thinking=${chars("thinking")}`,
    );
  }
}

export async function* handleRun(
  input: RunAgentInput,
  store: SessionStore,
  signal: AbortSignal,
  opts: RunOptions = {},
): AsyncIterable<BaseEvent> {
  const { threadId, runId } = input;
  yield runStarted(threadId, runId);

  const userMessages = input.messages.filter((m) => m.role === "user");
  const last = userMessages.at(-1);
  if (!last) {
    yield runError("BAD_INPUT", "No user message in run input.");
    return;
  }

  const history = !store.get(threadId) && userMessages.length > 1 ? restoreHistory(input.messages) : undefined;

  const userContext = readUserContext(input);
  log.info(`[run] thread=${threadId} run=${runId} model=${userContext?.model ?? "default"}`);
  log.debug(`[run] thread=${threadId} context=${JSON.stringify(userContext)} prompt=${JSON.stringify(messageText(last).slice(0, 200))}`);

  const stats = createStatsCollector();
  let made: { entry: SessionEntry } | { error: unknown };
  try {
    made = { entry: await store.getOrCreate(threadId, userContext, history) };
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
  try {
    yield* runTurn({ input, entry, signal, opts, last, history, userContext, stats });
  } catch (err) {
    log.error(`[run] thread=${threadId} failed`, err);
    yield runError("INTERNAL_ERROR", "Something went wrong on the agent. Try again.");
  } finally {
    entry.busy = false;
    store.touch(threadId);
  }
}

type Turn = {
  input: RunAgentInput;
  entry: SessionEntry;
  signal: AbortSignal;
  opts: RunOptions;
  last: Message;
  history: HistoryMessage[] | undefined;
  userContext: UserContext | null;
  stats: StatsCollector;
};

async function* runTurn({ input, entry, signal, opts, last, history, userContext, stats }: Turn): AsyncGenerator<BaseEvent> {
  const { threadId, runId } = input;
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
      yield runError("MODEL_ERROR", err instanceof Error ? err.message : String(err));
      return;
    }
  }

  const edits = readWorkspaceEdits(input);
  if (edits?.cart) entry.cart?.applyEdits(edits.cart);
  if (edits && opts.workspace) applyEntityEdits(opts.workspace, threadId, edits);
  entry.evidence?.add(messageText(last));
  for (const m of history ?? []) entry.evidence?.add(m.text);
  if (opts.workspace) entry.evidence?.add(opts.workspace.summary(threadId));
  const statsEvent = (): BaseEvent => {
    const turn = entry.turnStats?.();
    return custom("run_stats", stats.snapshot(turn));
  };

  const translator = createTranslator({ newId: randomUUID, evidence: entry.evidence });
  const unsubscribe = entry.session.subscribe((e: PiEvent) => {
    logEvent(threadId, e);
    modelError = observe(stats, e) ?? modelError;
    push(translator.translate(e));
  });

  const unwatch = entry.frames?.subscribe((value) => push([custom("browser_frame", value)]));

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
      log.info(`[run] thread=${threadId} empty reply, asking for the answer`);
      start(EMPTY_REPLY_NUDGE);
      yield* drain();
    }
    for (const e of translator.finish()) yield e;
    if (signal.aborted) return;
    log.info(`[run] thread=${threadId} done error=${modelError ?? "none"}`);
    yield statsEvent();
    if (modelError) yield runError("MODEL_ERROR", modelError);
    else yield runFinished(threadId, runId);
  } finally {
    if (!done) await entry.session.abort().catch(() => {});
    await running;
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
    unwatch?.();
  }
}
