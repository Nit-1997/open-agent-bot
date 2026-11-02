import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ArtifactCard, parseArtifactId } from "@/components/artifacts/ArtifactCard";

describe("ArtifactCard", () => {
  it("parses id from tool result", () => {
    expect(parseArtifactId("artifact abcdefghijkl created: Plan")).toBe("abcdefghijkl");
    expect(parseArtifactId("html too large")).toBeNull();
  });

  it("shows the report inline in a sandboxed, scrollable frame with new tab, full screen and PDF", () => {
    render(<ArtifactCard idPrefix="t" toolCallId="a1" title="Diwali plan" result="artifact abcdefghijkl created: Diwali plan" />);
    const inline = screen.getByTitle("Diwali plan");
    expect(inline.tagName).toBe("IFRAME");
    expect(inline).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(inline).toHaveAttribute("src", "/api/artifacts/abcdefghijkl");
    expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", "/api/artifacts/abcdefghijkl");
    expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/artifacts/abcdefghijkl?format=pdf");
    fireEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    expect(screen.getByRole("dialog", { name: "Diwali plan" })).toBeInTheDocument();
    expect(screen.getAllByTitle("Diwali plan")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTitle("Diwali plan")).toHaveLength(1);
  });
});
