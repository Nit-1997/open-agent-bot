import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type Message, type RunAgentInput } from "@ag-ui/core";
import type { AuthUser } from "../auth/verify.js";
import type { ChatRepo, MessageRepo, NewMessage } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { agentPersona, type Profile } from "../../../shared/profile.js";
import { chatTitleFrom } from "../../../shared/chats.js";
import type { ProfileStore } from "../profile/store.js";
import type { UserContext } from "../prompt/userContext.js";
import {
  type HistoryMessage,
  SessionCapacityError,
  type SessionEntry,
  type SessionOwner,
  type SessionStore,
} from "../session/sessionStore.js";
import { applyEntityEdits } from "../workspace/edits.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { custom, runError, runFinished, runStarted } from "./events.js";
import { historyFromStored, messageText, readUserContext, readWorkspaceEdits } from "./input.js";
import { createStatsCollector, type StatsCollector, type Usage } from "./stats.js";
import { Transcript } from "./transcript.js";
import { createTranslator, type PiEvent } from "./translate.js";

export const EMPTY_REPLY_NUDGE =
  "Your reply so far shows me no answer. Answer my previous message now, in full, from what the tools already returned, without searching again.";

export const TIME_LIMIT_MESSAGE = "This run hit the time limit. Ask me to continue.";

export type RunContext = {
  user: AuthUser;
  chats: Pick<ChatRepo, "claim" | "touch">;
  messages: MessageRepo;
  profiles?: ProfileStore;
  workspace?: WorkspaceStore;
  timeLimitMs: number;
};

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

export async function readStored(profiles: ProfileStore | undefined): Promise<Profile | undefined> {
  if (!profiles) return undefined;
  return profiles.get().catch((err: unknown) => {
    log.warn("[run] couldn't read the profile", err);
    return undefined;
  });
}

export function mergeStored(ctx: UserContext | null, stored: Profile | undefined): UserContext | null {
  return ctx && stored ? { ...ctx, profile: { ...stored, ...ctx.profile } } : ctx;
}

export const NOT_SAVED_EVENT = "not_saved";
export const PROMPT_NOT_SAVED = "Your message wasn't saved, so this chat's history will miss it.";
export const REPLY_NOT_SAVED = "This reply wasn't saved, so it won't be in this chat's history.";

async function persist(ctx: RunContext, chatId: string, runId: string, rows: NewMessage[], titleIfEmpty?: string): Promise<boolean> {
  try {
    await ctx.messages.append(chatId, runId, rows);
    await ctx.chats.touch(chatId, { ...(titleIfEmpty && { titleIfEmpty }) });
    return true;
  } catch (err) {
    log.warn(`[run] user=${ctx.user.id} thread=${chatId} couldn't save messages`, err instanceof UserError ? err.kind : err);
    return false;
  }
}

const isTerminal = (e: BaseEvent) => e.type === EventType.RUN_FINISHED || e.type === EventType.RUN_ERROR;

async function claim(ctx: RunContext, chatId: string, model: string | undefined): Promise<BaseEvent | undefined> {
  try {
    await ctx.chats.claim(chatId, { model });
    return undefined;
  } catch (err) {
    if (err instanceof UserError && err.kind === "not_found") return runError("NOT_FOUND", "This chat doesn't exist.");
    log.warn(`[run] user=${ctx.user.id} thread=${chatId} claim failed`, err instanceof UserError ? err.kind : err);
    return runError("UNAVAILABLE", "Can't reach the data service. Try again in a minute.");
  }
}

async function seedHistory(ctx: RunContext, chatId: string): Promise<HistoryMessage[] | undefined> {
  const stored = await ctx.messages.history(chatId);
  const history = historyFromStored(stored.items);
  return history.length ? history : undefined;
}

export async function* handleRun(
  input: RunAgentInput,
  ctx: RunContext,
  store: SessionStore,
  signal: AbortSignal,
): AsyncIterable<BaseEvent> {
  const { threadId, runId } = input;
  yield runStarted(threadId, runId);

  const last = input.messages.filter((m) => m.role === "user").at(-1);
  const prompt = last ? messageText(last) : "";
  if (!last || !prompt.trim()) {
    yield runError("BAD_INPUT", "No user message in run input.");
    return;
  }

  const stored = await readStored(ctx.profiles);
  const userContext = mergeStored(readUserContext(input), stored);
  const persona = agentPersona(stored);
  const denied = await claim(ctx, threadId, userContext?.model);
  if (denied) {
    yield denied;
    return;
  }
  const owner: SessionOwner = { user: ctx.user, chatId: threadId };
  log.info(`[run] user=${ctx.user.id} thread=${threadId} run=${runId} model=${userContext?.model ?? "default"}`);
  log.debug(`[run] thread=${threadId} context=${JSON.stringify(userContext)} prompt=${JSON.stringify(prompt.slice(0, 200))}`);

  let made: { entry: SessionEntry; history?: HistoryMessage[] } | { error: unknown };
  try {
    const history = store.get(owner) ? undefined : await seedHistory(ctx, threadId);
    made = { entry: await store.getOrCreate(owner, userContext, persona, history), history };
  } catch (error) {
    made = { error };
  }
  if ("error" in made) {
    if (made.error instanceof SessionCapacityError) yield runError("BUSY", made.error.message);
    else if (made.error instanceof UserError) yield runError("UNAVAILABLE", made.error.message);
    else yield runError("MODEL_ERROR", made.error instanceof Error ? made.error.message : String(made.error));
    return;
  }
  const { entry, history } = made;
  if (entry.busy) {
    yield runError("THREAD_BUSY", "Still working on the last message.");
    return;
  }
  if (entry.lastRunId === runId) {
    yield runError("DUPLICATE_RUN", "This message was already handled.");
    return;
  }
  if (signal.aborted) return;
  entry.busy = true;
  entry.lastRunId = runId;
  const savedPrompt = await persist(
    ctx,
    threadId,
    runId,
    [{ role: "user", content: prompt.slice(0, 200_000), status: "complete" }],
    chatTitleFrom(prompt),
  );
  if (!savedPrompt) yield custom(NOT_SAVED_EVENT, { message: PROMPT_NOT_SAVED });
  const transcript = new Transcript();
  let saved = false;
  const saveReply = async (outcome: "complete" | "interrupted") => {
    saved = true;
    const text = transcript.text();
    const parts = transcript.parts();
    if (!text && !parts) return true;
    return persist(ctx, threadId, runId, [
      { role: "assistant", content: text.slice(0, 200_000), status: outcome, ...(parts && { parts }) },
    ]);
  };
  try {
    for await (const e of runTurn({ input, entry, signal, ctx, last, history, userContext, stats: createStatsCollector() })) {
      transcript.see(e);
      if (isTerminal(e) && !(await saveReply(e.type === EventType.RUN_FINISHED ? "complete" : "interrupted")))
        yield custom(NOT_SAVED_EVENT, { message: REPLY_NOT_SAVED });
      yield e;
    }
  } catch (err) {
    log.error(`[run] thread=${threadId} failed`, err);
    if (!saved && !(await saveReply("interrupted"))) yield custom(NOT_SAVED_EVENT, { message: REPLY_NOT_SAVED });
    yield runError("INTERNAL_ERROR", "Something went wrong on the agent. Try again.");
  } finally {
    entry.busy = false;
    store.touch(owner);
    if (!saved) await saveReply("interrupted");
    await store.release(owner, entry);
  }
}

type Turn = {
  input: RunAgentInput;
  entry: SessionEntry;
  signal: AbortSignal;
  ctx: RunContext;
  last: Message;
  history: HistoryMessage[] | undefined;
  userContext: UserContext | null;
  stats: StatsCollector;
};

async function* runTurn({ input, entry, signal, ctx, last, history, userContext, stats }: Turn): AsyncGenerator<BaseEvent> {
  const { threadId, runId } = input;
  entry.onRunStart?.();

  const queue: BaseEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let modelError: string | undefined;
  let timedOut = false;
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
  if (edits && ctx.workspace) await applyEntityEdits(ctx.workspace, edits);
  entry.evidence?.add(messageText(last));
  for (const m of history ?? []) entry.evidence?.add(m.text);
  if (ctx.workspace) entry.evidence?.add(await ctx.workspace.summary());
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

  const stopped = () => signal.aborted || timedOut;
  const onAbort = () => {
    void entry.session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    log.info(`[run] thread=${threadId} hit the time limit`);
    void entry.session.abort();
  }, ctx.timeLimitMs);

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
    if (!modelError && !stopped() && !translator.answered()) {
      log.info(`[run] thread=${threadId} empty reply, asking for the answer`);
      start(EMPTY_REPLY_NUDGE);
      yield* drain();
    }
    for (const e of translator.finish()) yield e;
    if (signal.aborted) return;
    log.info(`[run] thread=${threadId} done error=${modelError ?? "none"} timedOut=${timedOut}`);
    yield statsEvent();
    if (timedOut) yield runError("TIME_LIMIT", TIME_LIMIT_MESSAGE);
    else if (modelError) yield runError("MODEL_ERROR", modelError);
    else yield runFinished(threadId, runId);
  } finally {
    clearTimeout(timer);
    if (!done) await entry.session.abort().catch(() => {});
    await running;
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
    unwatch?.();
  }
}
