import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolActivity, toolLabel } from "@/components/ToolActivity";

describe("ToolActivity", () => {
  it("ToolActivity labels web_search with query", () => {
    render(<ToolActivity toolCallId="c1" name="web_search" status="executing" parameters={{ query: "diwali sweets" }} />);
    expect(screen.getByText('Searching "diwali sweets"')).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("labels other tools", () => {
    expect(toolLabel("fetch_page", { url: "https://www.amazon.in/dp/x" })).toBe("Opening www.amazon.in");
    expect(toolLabel("browse", { actions: [{ op: "goto", url: "https://flipkart.com/s" }] })).toBe("Opening flipkart.com");
    expect(toolLabel("browse", { actions: [{ op: "click", text: "4 stars" }] })).toBe("Browsing");
    expect(toolLabel("weather", { location: "Pune" })).toBe("Checking weather for Pune");
    expect(toolLabel("flights", { from: "SFO", to: "BLR" })).toBe("Searching flights SFO → BLR");
    expect(toolLabel("mystery", {})).toBe("mystery");
  });

  it("renders nothing for show_* tools since the card is the visible result", () => {
    const { container } = render(<ToolActivity toolCallId="c3" name="show_ui" status="complete" parameters={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows done state with unique ids", () => {
    const { container } = render(<ToolActivity toolCallId="c2" name="weather" status="complete" parameters={{ location: "Pune" }} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "false");
    const ids = [...container.querySelectorAll("*")].map((e) => e.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
