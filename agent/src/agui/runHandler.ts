import { randomUUID } from "node:crypto";
import { type BaseEvent, EventType, type Message, type RunAgentInput } from "@ag-ui/core";
import type { UserContext, UserProfile } from "../prompt/systemPrompt.js";
import type { SessionEntry, SessionStore } from "../session/sessionStore.js";
import type { CartEdits } from "../shop/cart.js";
import { createTranslator, type PiEvent } from "./translate.js";

export const SESSION_EXPIRED_MESSAGE = "This chat's session ended (the agent restarted or the chat sat idle). Start a new chat.";

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

export function readUserContext(input: RunAgentInput): UserContext | null {
  const item = input.context?.find((c) => c.description === "user_context");
  if (!item) return null;
  try {
    const v = typeof item.value === "string" ? JSON.parse(item.value) : item.value;
    if (v && typeof v.timeZone === "string" && typeof v.locale === "string" && typeof v.localTime === "string") {
      const model = clip(v.model, 100);
      const profile = readProfile(v.profile);
      return { timeZone: v.timeZone, locale: v.locale, localTime: v.localTime, ...(model && { model }), ...(profile && { profile }) };
    }
  } catch {}
  return null;
}

export function readCartEdits(input: RunAgentInput): CartEdits | null {
  const item = input.context?.find((c) => c.description === "cart_edits");
  if (!item?.value) return null;
  try {
    const v = typeof item.value === "string" ? JSON.parse(item.value) : item.value;
    if (!v || typeof v !== "object") return null;
    const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").slice(0, 50) : undefined);
    return {
      removed: strings(v.removed),
      qty: v.qty && typeof v.qty === "object" ? (v.qty as Record<string, number>) : undefined,
      picks: v.picks && typeof v.picks === "object" ? (v.picks as Record<string, Record<string, string>>) : undefined,
    };
  } catch {
    return null;
  }
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

  const userContext = readUserContext(input);
  console.log(`[run] thread=${threadId} context=${JSON.stringify(userContext)} prompt=${JSON.stringify(messageText(last).slice(0, 200))}`);

  let entry: SessionEntry;
  try {
    entry = await store.getOrCreate(threadId, userContext);
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

  const edits = readCartEdits(input);
  if (edits) entry.cart?.applyEdits(edits);
  entry.evidence?.add(messageText(last));
  const translator = createTranslator({ newId: randomUUID, evidence: entry.evidence });
  const unsubscribe = entry.session.subscribe((e: PiEvent) => {
    if (e.type === "tool_execution_start") console.log(`[run] thread=${threadId} tool=${e.toolName} args=${JSON.stringify(e.args).slice(0, 300)}`);
    if (e.type === "tool_execution_end") console.log(`[run] thread=${threadId} tool=${e.toolName} error=${e.isError} result=${JSON.stringify(e.result?.content?.[0]?.text ?? "").slice(0, 200)}`);
    if (e.type === "message_end") {
      const m = e.message as { role?: string; stopReason?: string; errorMessage?: string; usage?: { input: number; output: number; cacheRead: number } };
      if (m.role === "assistant" && m.usage) console.log(`[run] thread=${threadId} usage in=${m.usage.input} out=${m.usage.output} cacheRead=${m.usage.cacheRead}`);
      if (m.role === "assistant" && m.stopReason === "error") modelError = m.errorMessage ?? "The model returned an error.";
    }
    push(translator.translate(e));
  });

  const unwatch = entry.frames?.subscribe((value) => push([{ type: EventType.CUSTOM, name: "browser_frame", value } as BaseEvent]));

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
    console.log(`[run] thread=${threadId} done error=${modelError ?? "none"}`);
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
