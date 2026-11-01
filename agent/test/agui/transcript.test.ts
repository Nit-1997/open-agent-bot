import { type BaseEvent, EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { PART_RESULT_CHARS, PARTS_CHARS, Transcript } from "../../src/agui/transcript.js";

const start = (toolCallId: string, toolCallName: string) => ({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName }) as BaseEvent;
const args = (toolCallId: string, delta: string) => ({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta }) as BaseEvent;
const result = (toolCallId: string, content: string) =>
  ({ type: EventType.TOOL_CALL_RESULT, messageId: "r", toolCallId, content }) as BaseEvent;
const text = (messageId: string, delta: string) => ({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta }) as BaseEvent;

function feed(events: BaseEvent[]) {
  const t = new Transcript();
  for (const e of events) t.see(e);
  return t;
}

describe("Transcript", () => {
  it("has no parts when no report or widget was shown", () => {
    const t = feed([text("a", "Hi "), text("a", "there"), start("s", "web_search"), args("s", "{}"), result("s", "x")]);
    expect(t.text()).toBe("Hi there");
    expect(t.parts()).toBeUndefined();
  });

  it("keeps a report the run never finished, without a result, and clips long results", () => {
    const t = feed([
      start("r1", "research"),
      args("r1", '{"question":"q"}'),
      result("r1", "y".repeat(PART_RESULT_CHARS + 50)),
      start("c1", "create_artifact"),
    ]);
    expect(t.parts()).toEqual([
      { type: "tool", id: "r1", name: "research", args: "{}", result: "y".repeat(PART_RESULT_CHARS) },
      { type: "tool", id: "c1", name: "create_artifact", args: "{}" },
    ]);
  });

  it("drops widgets before reports when the parts are too big to save", () => {
    const t = feed([
      start("w", "show_widget"),
      args("w", JSON.stringify({ widget: { kind: "ui", blob: "z".repeat(PARTS_CHARS) } })),
      result("w", "rendered ui"),
      start("c", "create_artifact"),
      args("c", '{"title":"T","html":"<p>"}'),
      result("c", "artifact abcdefghijkl created: T"),
    ]);
    expect(t.parts()).toEqual([
      { type: "tool", id: "c", name: "create_artifact", args: '{"title":"T"}', result: "artifact abcdefghijkl created: T" },
    ]);
  });
});
