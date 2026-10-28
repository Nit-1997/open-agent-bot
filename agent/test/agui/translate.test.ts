import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { createTranslator, type PiEvent } from "../../src/agui/translate.js";
import { Evidence } from "../../src/grounding/evidence.js";

const renderStub = (data: unknown) =>
  (data as { kind?: string } | undefined)?.kind === "weather" ? ({ kind: "weather_card", location: "Pune" } as never) : null;

function ids() {
  let n = 0;
  return { newId: () => `id${++n}`, render: renderStub };
}

const assistantStart = { type: "message_start", message: { role: "assistant" } } as unknown as PiEvent;
const assistantEnd = { type: "message_end", message: { role: "assistant" } } as unknown as PiEvent;
const delta = (d: string) =>
  ({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: d } }) as unknown as PiEvent;
const thinking = { type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } } as unknown as PiEvent;
const toolStart = { type: "tool_execution_start", toolCallId: "call_1", toolName: "weather", args: { location: "Pune" } } as unknown as PiEvent;
const toolEnd = {
  type: "tool_execution_end",
  toolCallId: "call_1",
  toolName: "weather",
  isError: false,
  result: { content: [{ type: "text", text: "Sunny" }, { type: "text", text: " 28C" }], details: {} },
} as unknown as PiEvent;

const run = (events: PiEvent[], evidence?: Evidence) => {
  const t = createTranslator({ ...ids(), evidence });
  return [...events.flatMap((e) => t.translate(e)), ...t.finish()];
};

describe("createTranslator", () => {
  it("text deltas become one START, N CONTENT, one END", () => {
    const out = run([assistantStart, delta("Hel"), delta("lo"), assistantEnd]);
    expect(out.map((e) => e.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
    ]);
    expect(out[0]).toMatchObject({ messageId: "id1", role: "assistant" });
    expect(out[2]).toMatchObject({ messageId: "id1", delta: "lo" });
  });

  it("text then tool then text yields two distinct messageIds", () => {
    const out = run([assistantStart, delta("a"), assistantEnd, toolStart, toolEnd, assistantStart, delta("b"), assistantEnd]);
    const starts = out.filter((e) => e.type === EventType.TEXT_MESSAGE_START) as Array<{ messageId: string }>;
    expect(starts).toHaveLength(2);
    expect(starts[0].messageId).not.toBe(starts[1].messageId);
  });

  it("tool start emits START/ARGS/END with pi tool id and JSON args", () => {
    const out = run([assistantStart, assistantEnd, toolStart]);
    expect(out.map((e) => e.type)).toEqual([EventType.TOOL_CALL_START, EventType.TOOL_CALL_ARGS, EventType.TOOL_CALL_END]);
    expect(out[0]).toMatchObject({ toolCallId: "call_1", toolCallName: "weather", parentMessageId: "id1" });
    expect(JSON.parse((out[1] as unknown as { delta: string }).delta)).toEqual({ location: "Pune" });
  });

  it("tool end emits TOOL_CALL_RESULT with joined text content", () => {
    const out = run([toolEnd]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: EventType.TOOL_CALL_RESULT, toolCallId: "call_1", content: "Sunny 28C", role: "tool" });
  });

  it("a data tool result is rendered by the registry into a synthetic show_widget call", () => {
    const widget = { kind: "weather_card", location: "Pune" };
    const end = { ...toolEnd, result: { content: [{ type: "text", text: "Sunny" }], details: { data: { kind: "weather" } } } } as unknown as PiEvent;
    const out = run([assistantStart, assistantEnd, toolStart, end]);
    const tail = out.slice(3);
    expect(tail.map((e) => e.type)).toEqual([
      EventType.TOOL_CALL_RESULT,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
    ]);
    expect(tail[1]).toMatchObject({ toolCallId: "call_1-widget", toolCallName: "show_widget", parentMessageId: "id1" });
    expect(JSON.parse((tail[2] as unknown as { delta: string }).delta)).toEqual({ widget });
    expect(tail[4]).toMatchObject({ toolCallId: "call_1-widget", content: "rendered weather_card" });
  });

  it("render tools that return details.widget are shown as-is", () => {
    const widget = { kind: "weather_card", location: "Pune" };
    const end = { ...toolEnd, toolName: "show_x", result: { content: [{ type: "text", text: "ok" }], details: { widget } } } as unknown as PiEvent;
    const out = run([end]);
    expect(out.map((e) => e.type)).toContain(EventType.TOOL_CALL_START);
    expect(JSON.parse((out[2] as unknown as { delta: string }).delta)).toEqual({ widget });
  });

  it("renders at most one card per data kind in a run", () => {
    const end = (id: string) =>
      ({ ...toolEnd, toolCallId: id, result: { content: [{ type: "text", text: "x" }], details: { data: { kind: "weather" } } } }) as unknown as PiEvent;
    const starts = run([end("a"), end("b")]).filter((e) => e.type === EventType.TOOL_CALL_START);
    expect(starts).toHaveLength(1);
  });

  it("data the registry can't render emits nothing extra", () => {
    const end = { ...toolEnd, result: { content: [{ type: "text", text: "x" }], details: { data: { kind: "search_results" } } } } as unknown as PiEvent;
    expect(run([end]).map((e) => e.type)).toEqual([EventType.TOOL_CALL_RESULT]);
  });

  it("errored tool results never emit a widget", () => {
    const end = { ...toolEnd, isError: true, result: { content: [{ type: "text", text: "x" }], details: { data: { kind: "weather" } } } } as unknown as PiEvent;
    expect(run([end]).map((e) => e.type)).toEqual([EventType.TOOL_CALL_RESULT]);
  });

  it("closes an open text message before a tool call starts", () => {
    const out = run([assistantStart, delta("a"), toolStart]);
    expect(out.map((e) => e.type)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
    ]);
  });

  it("finish closes open message", () => {
    const out = run([assistantStart, delta("a")]);
    expect(out.at(-1)).toMatchObject({ type: EventType.TEXT_MESSAGE_END, messageId: "id1" });
  });

  it("unknown and thinking events are ignored", () => {
    const out = run([{ type: "turn_start" } as unknown as PiEvent, thinking, { type: "agent_settled" } as unknown as PiEvent]);
    expect(out).toEqual([]);
  });
});

const widgetArgs = (out: ReturnType<typeof run>) =>
  out
    .filter((e) => e.type === EventType.TOOL_CALL_ARGS && (e as unknown as { toolCallId: string }).toolCallId.endsWith("-widget"))
    .map((e) => JSON.parse((e as unknown as { delta: string }).delta).widget);

const searchEnd = {
  ...toolEnd,
  toolCallId: "s1",
  toolName: "web_search",
  result: { content: [{ type: "text", text: "Target Diya 12ct $6.99 In stock https://www.target.com/p/diya/-/A-1" }], details: {} },
} as unknown as PiEvent;

const uiEnd = (blocks: unknown[]) =>
  ({
    ...toolEnd,
    toolCallId: "u1",
    toolName: "show_ui",
    result: { content: [{ type: "text", text: "shown" }], details: { widget: { kind: "ui", title: "Shopping", blocks } } },
  }) as unknown as PiEvent;

describe("grounding", () => {
  it("marks card values no tool returned and keeps sourced ones clean", () => {
    const out = run([searchEnd, uiEnd([{ type: "list", items: [{ title: "Diya", value: "$6.99", badge: "In stock" }, { title: "Lantern", value: "$5.99" }] }])]);
    expect(widgetArgs(out)).toEqual([
      { kind: "ui", title: "Shopping", blocks: [{ type: "list", items: [{ title: "Diya", value: "$6.99", badge: "In stock" }, { title: "Lantern", value: "$5.99" }] }], unverified: ["$5.99"] },
    ]);
  });

  it("evidence persists across runs of the same session", () => {
    const evidence = new Evidence();
    run([searchEnd], evidence);
    const out = run([uiEnd([{ type: "text", text: "$6.99" }])], evidence);
    expect(widgetArgs(out)[0].unverified).toBeUndefined();
  });

  it("adds a note after a message whose text has unsourced claims", () => {
    const out = run([searchEnd, assistantStart, delta("Diyas $6.99, rangoli kit $7."), delta("49, ✅ In Stock"), assistantEnd]);
    const types = out.map((e) => e.type);
    expect(types.indexOf(EventType.TEXT_MESSAGE_END)).toBeLessThan(types.lastIndexOf(EventType.TOOL_CALL_START));
    expect(widgetArgs(out)).toEqual([{ kind: "grounding_note", claims: ["$7.49"] }]);
  });

  it("adds no note when the text is fully sourced, and notes each claim once per run", () => {
    expect(widgetArgs(run([searchEnd, assistantStart, delta("Diyas are $6.99."), assistantEnd]))).toEqual([]);
    const twice = run([assistantStart, delta("$7.49"), assistantEnd, assistantStart, delta("still $7.49"), assistantEnd]);
    expect(widgetArgs(twice)).toEqual([{ kind: "grounding_note", claims: ["$7.49"] }]);
  });

  it("checks text still open when the run finishes", () => {
    const t = createTranslator(ids());
    const out = [...[assistantStart, delta("$7.49")].flatMap((e) => t.translate(e)), ...t.finish()];
    expect(widgetArgs(out)).toEqual([{ kind: "grounding_note", claims: ["$7.49"] }]);
  });
});
