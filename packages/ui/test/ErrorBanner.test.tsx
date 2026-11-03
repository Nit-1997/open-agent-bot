import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "../src/components/ErrorBanner.tsx";

describe("ErrorBanner", () => {
  it("offers retry for model errors", () => {
    const onRetry = vi.fn();
    render(<ErrorBanner id="e" kind="MODEL_ERROR" message="connection refused" onRetry={onRetry} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("connection refused");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows busy message", () => {
    render(<ErrorBanner id="e" kind="THREAD_BUSY" onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Still working on the last message");
  });
});
