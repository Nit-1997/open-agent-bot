import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TurnView } from "@/components/chat/TurnView";
import type { Turn } from "@/lib/turns";
import { DEFAULT_AGENT } from "@shared/profile";

const turn: Turn = {
  id: "t1",
  user: { id: "u1", text: "fairlife milk on Shipt?" },
  items: [
    { kind: "text", id: "a1", text: "Yes, at Target for $5.79." },
    { kind: "widget", id: "w1", widget: { kind: "followups", replies: ["Make it high protein", "Gluten-free options"] } },
  ],
  steps: [],
  sources: [{ host: "shipt.com", url: "https://www.shipt.com/x", title: "Shipt" }] as Turn["sources"],
};

const view = (over: Partial<Parameters<typeof TurnView>[0]> = {}) =>
  render(
    <TurnView
      idPrefix="p"
      persona={DEFAULT_AGENT}
      turn={turn}
      running={false}
      locale="en-US"
      now={0}
      answered={false}
      onAnswer={() => {}}
      {...over}
    />,
  );

describe("follow-up pills", () => {
  it("shows tappable follow-ups after the sources that send the reply", () => {
    const onAnswer = vi.fn();
    const { container } = view({ onAnswer });
    const pill = screen.getByRole("button", { name: "Make it high protein" });
    const sources = container.querySelector("[id$='-sources']");
    expect(sources && sources.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(pill);
    expect(onAnswer).toHaveBeenCalledWith("Make it high protein");
  });

  it("hides follow-ups once the conversation has moved on or while running", () => {
    view({ answered: true });
    expect(screen.queryByRole("button", { name: "Make it high protein" })).toBeNull();
  });
});

describe("quick-check answers", () => {
  it("shows a small line instead of a chat bubble", () => {
    const quiet: Turn = { ...turn, id: "answer-1", user: { id: "answer-1", text: "Travelers: 2\nBudget: Saver" }, items: [] };
    render(
      <TurnView
        idPrefix="p"
        persona={DEFAULT_AGENT}
        turn={quiet}
        running={false}
        locale="en-US"
        now={0}
        answered={false}
        onAnswer={() => {}}
      />,
    );
    expect(screen.getByText("Sent your answers")).toBeInTheDocument();
    expect(document.querySelector("#p-turn-answer-1-user-text")?.closest("details")).not.toHaveAttribute("open");
  });
});
