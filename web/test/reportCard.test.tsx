import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportCard } from "@/components/reports/ReportCard";
import { expectUniqueIds } from "./support/ids";

const result = "artifact abcdefghijkl created: Diwali plan";
const card = (over: Partial<Parameters<typeof ReportCard>[0]> = {}) => (
  <ReportCard idPrefix="chat-pane-x" toolCallId="tc1" title="Diwali plan" result={result} pressed={false} hint="right" onOpen={() => {}} {...over} />
);

describe("ReportCard", () => {
  it("is a pressable button named after the report, with a decorative thumbnail", () => {
    const onOpen = vi.fn();
    const { container } = render(card({ onOpen }));
    const button = screen.getByRole("button", { name: "Open report: Diwali plan" });
    expect(button.id).toBe("chat-pane-x-artifact-card-tc1");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(document.getElementById("chat-pane-x-artifact-card-tc1-title")).toHaveTextContent("Diwali plan");
    expect(document.getElementById("chat-pane-x-artifact-card-tc1-hint")).toHaveTextContent("Report · open on the right");
    const img = document.getElementById("chat-pane-x-artifact-card-tc1-thumb-img")!;
    expect(img).toHaveAttribute("src", "/api/artifacts/abcdefghijkl?format=thumb");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img.closest("[aria-hidden='true']")).not.toBeNull();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith("abcdefghijkl", "tc1");
    expectUniqueIds(container);
  });

  it("follows the open report with aria-pressed and says tap to read on smaller screens", () => {
    render(card({ pressed: true, hint: "tap" }));
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Report · tap to read")).toBeInTheDocument();
  });

  it("swaps in the placeholder when the thumbnail fails, without asking again", () => {
    const { container } = render(card());
    fireEvent.error(document.getElementById("chat-pane-x-artifact-card-tc1-thumb-img")!);
    expect(document.getElementById("chat-pane-x-artifact-card-tc1-thumb-img")).toBeNull();
    expect(document.getElementById("chat-pane-x-artifact-card-tc1-thumb-fallback")).not.toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expectUniqueIds(container);
  });

  it("shows a status card while the report is written and the error line when it failed", () => {
    const { rerender, container } = render(card({ result: undefined }));
    expect(screen.getByRole("status")).toHaveTextContent("Writing the report…");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Diwali plan")).toBeInTheDocument();
    expectUniqueIds(container);
    rerender(card({ result: "html too large (max 2MB)" }));
    expect(screen.getByText("Couldn't create the page: html too large (max 2MB)")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
