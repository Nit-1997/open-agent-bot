import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveBrowser } from "@/components/chat/LiveBrowser";

const frame = { url: "https://www.shipt.com/shop/stores/search?query=rice", data: "/9j/AAA" };

describe("LiveBrowser", () => {
  it("shows the live page and where the agent is while it works", () => {
    render(<LiveBrowser id="lb1" frame={frame} live />);
    expect(screen.getByText("Browsing shipt.com")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Live view of shipt.com" })).toHaveAttribute("src", "data:image/jpeg;base64,/9j/AAA");
  });

  it("collapses to a thumbnail after the run and expands on click", () => {
    render(<LiveBrowser id="lb2" frame={frame} live={false} />);
    expect(screen.queryByText("Browsing shipt.com")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Last view of shipt\.com/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("img", { name: "Last view of shipt.com" })).toBeInTheDocument();
  });
});
