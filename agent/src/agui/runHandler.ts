import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type Message, type RunAgentInput } from "@ag-ui/core";
import type { UserContext } from "../prompt/systemPrompt.js";
import type { SessionStore } from "../session/sessionStore.js";
import { createTranslator, type PiEvent } from "./translate.js";

export const SESSION_EXPIRED_MESSAGE = "This chat's session ended (the agent restarted or the chat sat idle). Start a new chat.";

function messageText(m: Message): string {
  const c = (m as { content?: unknown }).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p?.type === "text" ? p.text : "")).join("");
  return "";
}

export function readUserContext(input: RunAgentInput): UserContext | null {
  const item = input.context?.find((c) => c.description === "user_context");
  if (!item) return null;
  try {
    const v = typeof item.value === "string" ? JSON.parse(item.value) : item.value;
    if (v && typeof v.timeZone === "string" && typeof v.locale === "string" && typeof v.localTime === "string") {
      return { timeZone: v.timeZone, locale: v.locale, localTime: v.localTime };
    }
  } catch {}
  return null;
}

function runError(code: string, message: string): BaseEvent {
  return { type: EventType.RUN_ERROR, code, message } as BaseEvent;
}

export async function* handleRun(input: RunAgentInput, store: SessionStore, signal: AbortSignal): AsyncIterable<BaseEvent> {
  const { threadId, runId } = input;
  yield { type: EventType.RUN_STARTED, threadId, runId } as BaseEvent;

  const userMessages = input.messages.filter((m) => m.role === "user");
  const last = userMessages.at(-1);
  if (!last) {
    yield runError("BAD_INPUT", "No user message in run input.");
    return;
  }

  if (!store.get(threadId) && userMessages.length > 1) {
    yield runError("SESSION_EXPIRED", SESSION_EXPIRED_MESSAGE);
    return;
  }

  let entry;
  try {
    entry = await store.getOrCreate(threadId, readUserContext(input));
  } catch (err) {
    yield runError("MODEL_ERROR", err instanceof Error ? err.message : String(err));
    return;
  }
  if (entry.busy) {
    yield runError("THREAD_BUSY", "Still working on the last message.");
    return;
  }
  if (signal.aborted) return;
  entry.busy = true;

  const queue: BaseEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let modelError: string | undefined;
  const push = (events: BaseEvent[]) => {
    if (!events.length) return;
    queue.push(...events);
    wake?.();
  };

  const translator = createTranslator({ newId: randomUUID });
  const unsubscribe = entry.session.subscribe((e: PiEvent) => {
    if (e.type === "message_end") {
      const m = e.message as { role?: string; stopReason?: string; errorMessage?: string };
      if (m.role === "assistant" && m.stopReason === "error") modelError = m.errorMessage ?? "The model returned an error.";
    }
    push(translator.translate(e));
  });

  const onAbort = () => {
    void entry.session.abort();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  const running = entry.session
    .prompt(messageText(last))
    .catch((err: unknown) => {
      modelError = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      done = true;
      wake?.();
    });

  try {
    while (true) {
      while (queue.length) yield queue.shift()!;
      if (done) break;
      await new Promise<void>((r) => (wake = r));
      wake = undefined;
    }
    await running;
    for (const e of translator.finish()) yield e;
    if (signal.aborted) return;
    if (modelError) yield runError("MODEL_ERROR", modelError);
    else yield { type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent;
  } finally {
    if (!done) await entry.session.abort().catch(() => {});
    await running;
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
    entry.busy = false;
    store.touch(threadId);
  }
}
