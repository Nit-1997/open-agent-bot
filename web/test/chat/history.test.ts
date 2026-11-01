import type { StoredMessage } from "@shared/chats";
import { describe, expect, it } from "vitest";
import { STOPPED_MARK, toHistory } from "@/lib/chats";
import { buildTurns, type ChatMessage } from "@/lib/turns";

const at = "2026-11-01T00:00:00Z";
const cart = { kind: "cart", stores: ["traderjoes"], scope: ["Trader Joe's"], items: [], picks: {}, homes: {} };

const stored: StoredMessage[] = [
  { role: "user", content: "write me a Big Sur guide", status: "complete", createdAt: at },
  {
    role: "assistant",
    content: "Writing it up.\n\nHere it is.",
    status: "complete",
    createdAt: at,
    parts: [
      { type: "text", text: "Writing it up." },
      { type: "tool", id: "c2", name: "create_artifact", args: '{"title":"Big Sur guide"}', result: "artifact abcdefghijkl created: Big Sur guide" },
      { type: "tool", id: "c3-widget", name: "show_widget", args: JSON.stringify({ widget: cart }), result: "rendered cart" },
      { type: "text", text: "Here it is." },
    ],
  },
  { role: "user", content: "and a shorter one", status: "complete", createdAt: at },
  {
    role: "assistant",
    content: "",
    status: "interrupted",
    createdAt: at,
    parts: [{ type: "tool", id: "c9", name: "create_artifact", args: '{"title":"Short"}' }],
  },
  { role: "user", content: "thanks", status: "complete", createdAt: at },
  { role: "assistant", content: "Anytime.", status: "interrupted", createdAt: at },
];

describe("toHistory", () => {
  it("rebuilds saved reports and widgets as tool calls, in order, so a reloaded chat shows them", () => {
    const turns = buildTurns(toHistory("chat", stored) as ChatMessage[]);
    expect(turns).toHaveLength(3);
    expect(turns[0].items.map((i) => (i.kind === "text" ? i.text : `${i.kind}:${i.id}`))).toEqual([
      "Writing it up.",
      "artifact:c2",
      "widget:c3-widget",
      "Here it is.",
    ]);
    expect(turns[0].items[1]).toMatchObject({ title: "Big Sur guide", result: "artifact abcdefghijkl created: Big Sur guide" });
    expect(turns[0].items[2]).toMatchObject({ widget: cart });
  });

  it("shows a report the run never finished as failed rather than still writing", () => {
    const turns = buildTurns(toHistory("chat", stored) as ChatMessage[]);
    expect(turns[1].items).toEqual([{ kind: "artifact", id: "c9", title: "Short", result: "" }, expect.objectContaining({ kind: "text", text: STOPPED_MARK })]);
  });

  it("keeps plain replies and marks stopped ones", () => {
    const turns = buildTurns(toHistory("chat", stored) as ChatMessage[]);
    expect(turns[2].items).toEqual([expect.objectContaining({ kind: "text", text: `Anytime.\n\n${STOPPED_MARK}` })]);
  });

  it("gives every rebuilt message a unique id", () => {
    const ids = toHistory("chat", stored).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
