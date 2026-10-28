import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { handleRun, readUserContext } from "../../src/agui/runHandler.js";
import { Evidence } from "../../src/grounding/evidence.js";
import type { UserContext } from "../../src/prompt/systemPrompt.js";
import { type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("hi"));
  emit(ev.assistantEnd());
};

function setup(script: Script = say, evidence?: Evidence, setModel?: (id: string) => Promise<void>) {
  const session = fakeSession(script);
  const runStarts = { count: 0 };
  const contexts: Array<UserContext | null> = [];
  const store = new SessionStore({
    idleMs: 60000,
    create: async (_t, ctx): Promise<SessionEntry> => {
      contexts.push(ctx);
      return { session, busy: false, lastUsed: 0, dispose: async () => {}, onRunStart: () => runStarts.count++, evidence, setModel };
    },
  });
  return { session, store, contexts, runStarts };
}

function input(over: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "t1",
    runId: "r1",
    messages: [{ id: "m1", role: "user", content: "hello" }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...over,
  } as RunAgentInput;
}

async function collect(it: AsyncIterable<BaseEvent>) {
  const out: BaseEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("handleRun", () => {
  it("streams RUN_STARTED, text events, RUN_FINISHED", async () => {
    const { store, session } = setup();
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(out.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(session.prompts).toEqual(["hello"]);
  });

  it("switches the session to the model the user picked before prompting", async () => {
    const calls: string[] = [];
    const { store, session } = setup(say, undefined, async (id) => {
      calls.push(`model:${id}:${session.prompts.length}`);
    });
    const value = JSON.stringify({ timeZone: "UTC", locale: "en-US", localTime: "t", model: "chat-sonnet-5.5" });
    await collect(handleRun(input({ context: [{ description: "user_context", value }] }), store, new AbortController().signal));
    expect(calls).toEqual(["model:chat-sonnet-5.5:0"]);
  });

  it("reports a model switch failure as a model error", async () => {
    const { store } = setup(say, undefined, async () => {
      throw new Error("model chat-x is not available");
    });
    const value = JSON.stringify({ timeZone: "UTC", locale: "en-US", localTime: "t", model: "chat-x" });
    const out = await collect(handleRun(input({ context: [{ description: "user_context", value }] }), store, new AbortController().signal));
    expect(out.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: "MODEL_ERROR", message: "model chat-x is not available" });
  });

  it("treats what the user said as evidence for the reply", async () => {
    const echo: Script = async (emit) => {
      emit(ev.assistantStart);
      emit(ev.delta("With a $200 budget, rangoli kits run $7.49."));
      emit(ev.assistantEnd());
    };
    const { store } = setup(echo, new Evidence());
    const out = await collect(handleRun(input({ messages: [{ id: "m1", role: "user", content: "my budget is $200" }] as RunAgentInput["messages"] }), store, new AbortController().signal));
    const note = out.find((e) => e.type === EventType.TOOL_CALL_ARGS) as unknown as { delta: string };
    expect(JSON.parse(note.delta).widget).toEqual({ kind: "grounding_note", claims: ["$7.49"] });
  });

  it("calls onRunStart once per run so per-reply budgets reset", async () => {
    const { store, runStarts } = setup();
    await collect(handleRun(input(), store, new AbortController().signal));
    await collect(handleRun(input({ runId: "r2", messages: [{ id: "m1", role: "user", content: "a" }, { id: "m2", role: "user", content: "b" }] as RunAgentInput["messages"] }), store, new AbortController().signal));
    expect(runStarts.count).toBe(2);
  });

  it("expired thread yields SESSION_EXPIRED", async () => {
    const { store } = setup();
    const msgs = [
      { id: "m1", role: "user", content: "a" },
      { id: "m2", role: "assistant", content: "b" },
      { id: "m3", role: "user", content: "c" },
    ] as RunAgentInput["messages"];
    const out = await collect(handleRun(input({ messages: msgs }), store, new AbortController().signal));
    expect(out.map((e) => e.type)).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
    expect(out[1]).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(store.get("t1")).toBeUndefined();
  });

  it("rejects concurrent run on same thread", async () => {
    const { store, session } = setup(async (emit) => {
      emit(ev.assistantStart);
      await session.waitForAbort();
    });
    const ac = new AbortController();
    const first = collect(handleRun(input(), store, ac.signal));
    await new Promise((r) => setTimeout(r, 10));
    const second = await collect(handleRun(input({ runId: "r2" }), store, new AbortController().signal));
    expect(second.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: "THREAD_BUSY" });
    ac.abort();
    await first;
  });

  it("client abort aborts pi run and frees thread", async () => {
    const { store, session } = setup(async (emit) => {
      emit(ev.assistantStart);
      emit(ev.delta("partial"));
      await session.waitForAbort();
    });
    const ac = new AbortController();
    const done = collect(handleRun(input(), store, ac.signal));
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await done;
    expect(session.abortCalls).toBe(1);
    expect(store.get("t1")?.busy).toBe(false);
  });

  it("consumer cancellation aborts pi and keeps the thread busy until the prompt settles", async () => {
    let settled = false;
    const { store, session } = setup(async (emit) => {
      emit(ev.assistantStart);
      emit(ev.delta("partial"));
      await session.waitForAbort();
      await new Promise((r) => setTimeout(r, 30));
      settled = true;
    });
    const gen = handleRun(input(), store, new AbortController().signal)[Symbol.asyncIterator]();
    await gen.next();
    await gen.next();
    await gen.return?.(undefined);
    expect(session.abortCalls).toBe(1);
    expect(settled).toBe(true);
    expect(store.get("t1")?.busy).toBe(false);
  });

  it("an already-aborted signal stops the run before prompting", async () => {
    const { store, session } = setup();
    const ac = new AbortController();
    ac.abort();
    await collect(handleRun(input(), store, ac.signal));
    expect(session.prompts).toEqual([]);
    expect(store.get("t1")?.busy).toBe(false);
  });

  it("model error yields MODEL_ERROR and frees thread", async () => {
    const { store } = setup(async (emit) => {
      emit(ev.assistantStart);
      emit(ev.assistantEnd("error", "connection refused"));
    });
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(out.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: "MODEL_ERROR", message: "connection refused" });
    expect(store.get("t1")?.busy).toBe(false);
  });

  it("thrown prompt error yields MODEL_ERROR", async () => {
    const { store } = setup(async () => {
      throw new Error("boom");
    });
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(out.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: "MODEL_ERROR", message: "boom" });
  });

  it("reads user_context from input.context", async () => {
    const { store, contexts } = setup();
    const ctx = { timeZone: "America/Los_Angeles", locale: "en-US", localTime: "2026-10-27T14:00" };
    await collect(
      handleRun(input({ context: [{ description: "user_context", value: JSON.stringify(ctx) }] }), store, new AbortController().signal),
    );
    expect(contexts).toEqual([ctx]);
  });
});

describe("readUserContext", () => {
  const ctx = (v: unknown) => readUserContext(input({ context: [{ description: "user_context", value: JSON.stringify(v) }] }));

  it("reads the model and a trimmed profile", () => {
    const r = ctx({
      timeZone: "UTC",
      locale: "en-US",
      localTime: "t",
      model: "chat-sonnet-5.5",
      profile: { name: "  Nitin ", home: "Sunnyvale", interests: ["Vegetarian", 7, "x".repeat(80)], notes: "n".repeat(2000), extra: "dropped" },
    });
    expect(r?.model).toBe("chat-sonnet-5.5");
    expect(r?.profile).toEqual({ name: "Nitin", home: "Sunnyvale", interests: ["Vegetarian", "x".repeat(40)], notes: "n".repeat(1000) });
  });

  it("ignores a profile that isn't an object and empty fields", () => {
    expect(ctx({ timeZone: "UTC", locale: "en-US", localTime: "t", profile: "hi", model: 3 })).toEqual({ timeZone: "UTC", locale: "en-US", localTime: "t" });
    expect(ctx({ timeZone: "UTC", locale: "en-US", localTime: "t", profile: { name: " " } })?.profile).toBeUndefined();
  });
});
