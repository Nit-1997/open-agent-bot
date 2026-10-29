import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { EMPTY_REPLY_NUDGE, handleRun, readUserContext } from "../../src/agui/runHandler.js";
import { FrameBus } from "../../src/browser/frames.js";
import { ActiveCart } from "../../src/shop/cart.js";
import type { PiEvent } from "../../src/agui/translate.js";
import { Evidence } from "../../src/grounding/evidence.js";
import type { UserContext } from "../../src/prompt/systemPrompt.js";
import { type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("hi"));
  emit(ev.assistantEnd());
};

function setup(script: Script = say, evidence?: Evidence, setModel?: (id: string) => Promise<void>, frames?: FrameBus, cart?: ActiveCart, extra: Partial<SessionEntry> = {}) {
  const session = fakeSession(script);
  const runStarts = { count: 0 };
  const contexts: Array<UserContext | null> = [];
  const store = new SessionStore({
    idleMs: 60000,
    create: async (_t, ctx): Promise<SessionEntry> => {
      contexts.push(ctx);
      return { session, busy: false, lastUsed: 0, dispose: async () => {}, onRunStart: () => runStarts.count++, evidence, setModel, frames, cart, ...extra };
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

const customEvents = (out: BaseEvent[]) => out.filter((e) => e.type === EventType.CUSTOM) as unknown as Array<{ name: string; value: Record<string, unknown> }>;

const usage = (input: number, output: number, cacheRead: number, total?: number) => ({ input, output, cacheRead, ...(total !== undefined && { cost: { total } }) });
const assistantEndWith = (u: object) => ({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: u } }) as unknown as PiEvent;
const toolStart = (toolName: string, args: unknown) => ({ type: "tool_execution_start", toolCallId: `c-${toolName}`, toolName, args }) as unknown as PiEvent;

describe("run_stats", () => {
  it("sums usage across the run including the nudge, counts tools and collects loaded skills, just before RUN_FINISHED", async () => {
    let turn = 0;
    const script: Script = async (emit) => {
      emit(ev.assistantStart);
      if (turn === 0) {
        emit(toolStart("load_skill", { name: "trip-planning" }));
        emit(toolStart("stays", { q: "x" }));
        emit(toolStart("load_skill", { name: "trip-planning" }));
      } else emit(ev.delta("Answer."));
      emit(assistantEndWith(usage(100 * (turn + 1), 10, 5, 0.25)));
      turn++;
    };
    const { store } = setup(script, undefined, undefined, undefined, undefined, { turnStats: () => ({ jevCalls: 3, jevCostUsd: 0.01 }) });
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    const stats = customEvents(out).find((e) => e.name === "run_stats");
    expect(stats?.value).toMatchObject({ inputTokens: 300, outputTokens: 20, cacheRead: 10, costUsd: 0.5, jevCalls: 3, jevCostUsd: 0.01, toolCalls: 3, skills: ["trip-planning"] });
    expect(typeof stats?.value.durationMs).toBe("number");
    expect(out.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(out.at(-2)).toMatchObject({ type: EventType.CUSTOM, name: "run_stats" });
  });

  it("adds classifier calls and cost from codemode scripts to the jev counters and counts llm turns", async () => {
    let turn = 0;
    const script: Script = async (emit) => {
      emit(ev.assistantStart);
      if (turn === 0) {
        emit({ type: "tool_execution_end", toolCallId: "c1", toolName: "codemode", isError: false, result: { content: [], details: { calls: [{ name: "weather" }, { name: "models.classify" }, { name: "models.classify" }] } } } as unknown as PiEvent);
        emit({ type: "message_end", message: { role: "toolResult", usage: { input: 5, output: 1, cost: { total: 0.004 } } } } as unknown as PiEvent);
      } else emit(ev.delta("Answer."));
      emit(assistantEndWith(usage(10, 2, 0, 0.1)));
      turn++;
    };
    const { store } = setup(script, undefined, undefined, undefined, undefined, { turnStats: () => ({ jevCalls: 1, jevCostUsd: 0.001 }) });
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    const stats = customEvents(out).find((e) => e.name === "run_stats");
    expect(stats?.value).toMatchObject({ jevCalls: 3, jevCostUsd: 0.005, costUsd: 0.2, llmTurns: 2 });
  });

  it("defaults cost and jev stats to zero when they are not reported", async () => {
    const script: Script = async (emit) => {
      emit(ev.assistantStart);
      emit(ev.delta("hi"));
      emit(assistantEndWith(usage(7, 3, 0)));
    };
    const { store } = setup(script);
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(customEvents(out).find((e) => e.name === "run_stats")?.value).toMatchObject({ costUsd: 0, jevCalls: 0, jevCostUsd: 0, inputTokens: 7, outputTokens: 3, toolCalls: 0, skills: [] });
  });

  it("emits run_stats before RUN_ERROR on a model error", async () => {
    const script: Script = async (emit) => {
      emit(ev.assistantStart);
      emit(ev.assistantEnd("error", "boom"));
    };
    const { store } = setup(script);
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(out.at(-1)?.type).toBe(EventType.RUN_ERROR);
    expect(out.at(-2)).toMatchObject({ type: EventType.CUSTOM, name: "run_stats" });
  });
});

describe("handleRun", () => {
  it("applies the user's cart edits sent with the message before the agent runs", async () => {
    const cart = new ActiveCart();
    cart.start(["shipt"], [{ query: "rice", qty: 1 }, { query: "black beans", qty: 2 }]);
    const { store } = setup(say, undefined, undefined, undefined, cart);
    const edits = { removed: ["black beans"], qty: { rice: 4 } };
    await collect(handleRun(input({ context: [{ description: "cart_edits", value: JSON.stringify(edits) }] }), store, new AbortController().signal));
    expect(cart.items).toEqual([{ query: "rice", qty: 4 }]);
  });

  it("forwards browser frames published during the run as CUSTOM events, and none after", async () => {
    const frames = new FrameBus(0);
    const script: Script = async (emit) => {
      emit(ev.assistantStart);
      frames.publish({ url: "https://www.shipt.com/x", data: "abc" });
      emit(ev.delta("Found it."));
      emit(ev.assistantEnd());
    };
    const { store } = setup(script, undefined, undefined, frames);
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    const custom = customEvents(out).filter((e) => e.name !== "run_stats");
    expect(custom).toEqual([{ type: EventType.CUSTOM, name: "browser_frame", value: { url: "https://www.shipt.com/x", data: "abc" } }]);
    expect(frames.size).toBe(0);
    expect(out.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("asks once more when a run ends without showing the user an answer", async () => {
    let turn = 0;
    const script: Script = async (emit) => {
      emit(ev.assistantStart);
      if (turn++ > 0) emit(ev.delta("Here is the answer."));
      emit(ev.assistantEnd());
    };
    const { store, session } = setup(script);
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(session.prompts).toEqual(["hello", EMPTY_REPLY_NUDGE]);
    expect(out.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)).toHaveLength(1);
    expect(out.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("asks only once, even if the second reply is empty too", async () => {
    const silent: Script = async (emit) => {
      emit(ev.assistantStart);
      emit(ev.assistantEnd());
    };
    const { store, session } = setup(silent);
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(session.prompts).toHaveLength(2);
    expect(out.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("streams RUN_STARTED, text events, RUN_FINISHED", async () => {
    const { store, session } = setup();
    const out = await collect(handleRun(input(), store, new AbortController().signal));
    expect(out.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.CUSTOM,
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

  it("keeps a sane viewport and drops a bad one", () => {
    expect(ctx({ timeZone: "UTC", locale: "en-US", localTime: "t", viewport: { width: 558.4, height: 698 } })?.viewport).toEqual({ width: 558, height: 698 });
    expect(ctx({ timeZone: "UTC", locale: "en-US", localTime: "t", viewport: { width: "wide", height: 698 } })?.viewport).toBeUndefined();
    expect(ctx({ timeZone: "UTC", locale: "en-US", localTime: "t", viewport: { width: 50, height: 698 } })?.viewport).toBeUndefined();
  });

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
