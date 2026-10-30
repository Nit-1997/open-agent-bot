import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { createFollowupSplitter, parseFollowups } from "../../src/agui/followups.js";
import { createTranslator, type PiEvent } from "../../src/agui/translate.js";

const feed = (chunks: string[]) => {
  const s = createFollowupSplitter();
  const visible = chunks.map((c) => s.push(c)).join("") + s.flush();
  return { visible, replies: s.take() };
};

describe("follow-up line", () => {
  it("splits the tagged last line from the answer", () => {
    expect(feed(["Valletta is warmest.\n<followups>Flights to Valletta | Hotels in Valencia</followups>"])).toEqual({
      visible: "Valletta is warmest.\n",
      replies: ["Flights to Valletta", "Hotels in Valencia"],
    });
  });

  it("never leaks a tag that streams in pieces", () => {
    const text = "Answer.\n<followups>A | B | C</followups>";
    for (let size = 1; size <= 7; size++) {
      const chunks = text.match(new RegExp(`[\\s\\S]{1,${size}}`, "g")) ?? [];
      expect(feed(chunks)).toEqual({ visible: "Answer.\n", replies: ["A", "B", "C"] });
    }
  });

  it("keeps text that only looks like the start of a tag", () => {
    expect(feed(["Use a <fol", "der> for it, and 3 < 4."])).toEqual({ visible: "Use a <folder> for it, and 3 < 4.", replies: null });
  });

  it("reads an unclosed tag at the end of the message", () => {
    expect(feed(["Done.\n<followups>Cheaper picks | Vegan"])).toEqual({ visible: "Done.\n", replies: ["Cheaper picks", "Vegan"] });
  });

  it("keeps text written after the tag", () => {
    expect(feed(["<followups>A | B</followups>\nMore."])).toEqual({ visible: "\nMore.", replies: ["A", "B"] });
  });

  it("cleans bullets, numbers, quotes and blank items", () => {
    expect(parseFollowups('\n- "Make it vegan"\n2. Under $20 || ')).toEqual(["Make it vegan", "Under $20"]);
  });
});

describe("translator follow-ups", () => {
  const assistantStart = { type: "message_start", message: { role: "assistant" } } as unknown as PiEvent;
  const assistantEnd = { type: "message_end", message: { role: "assistant" } } as unknown as PiEvent;
  const delta = (d: string) => ({ type: "message_update", message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: d } }) as unknown as PiEvent;
  const translate = (events: PiEvent[]) => {
    let n = 0;
    const t = createTranslator({ newId: () => `id${++n}`, render: () => null });
    const out = [...events.flatMap((e) => t.translate(e)), ...t.finish()];
    const text = out.filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT).map((e) => (e as unknown as { delta: string }).delta).join("");
    const widgets = out.filter((e) => e.type === EventType.TOOL_CALL_ARGS).map((e) => JSON.parse((e as unknown as { delta: string }).delta).widget);
    return { text, widgets, answered: t.answered(), types: out.map((e) => e.type) };
  };

  it("shows the answer as text and the tag as follow-up buttons after it", () => {
    const r = translate([assistantStart, delta("Top 3: Valletta, Valencia, Palermo.\n<follow"), delta("ups>Flights | Hotels</followups>"), assistantEnd]);
    expect(r.text).toBe("Top 3: Valletta, Valencia, Palermo.\n");
    expect(r.widgets).toEqual([{ kind: "followups", replies: ["Flights", "Hotels"] }]);
    expect(r.types.indexOf(EventType.TEXT_MESSAGE_END)).toBeLessThan(r.types.indexOf(EventType.TOOL_CALL_START));
    expect(r.answered).toBe(true);
  });

  it("does not count a reply that is only follow-ups as an answer", () => {
    const r = translate([assistantStart, delta("<followups>Flights | Hotels</followups>"), assistantEnd]);
    expect(r.text).toBe("");
    expect(r.widgets).toEqual([{ kind: "followups", replies: ["Flights", "Hotels"] }]);
    expect(r.answered).toBe(false);
  });

  it("shows follow-ups once per reply and trims them to fit", () => {
    const r = translate([
      assistantStart,
      delta(`One.\n<followups>${"x".repeat(50)} | b | c | d | e</followups>`),
      assistantEnd,
      assistantStart,
      delta("Two.\n<followups>Again</followups>"),
      assistantEnd,
    ]);
    expect(r.widgets).toEqual([{ kind: "followups", replies: [`${"x".repeat(39)}…`, "b", "c", "d"] }]);
  });
});
