import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../../src/components/chat/Composer.tsx";

describe("Composer", () => {
  it("keeps the cursor in the message box after sending with the button", () => {
    const onSend = vi.fn();
    render(<Composer id="c" placeholder="Ask Juno" label="Message Juno" running={false} onSend={onSend} onStop={() => {}} />);
    const box = screen.getByLabelText("Message Juno");
    expect(box).toHaveAttribute("id", "c-input");
    expect(box).toHaveAttribute("placeholder", "Ask Juno");
    fireEvent.change(box, { target: { value: "Plan my weekend" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("Plan my weekend");
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });
});
