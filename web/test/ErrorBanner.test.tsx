import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBanner } from "@/components/ErrorBanner";

describe("ErrorBanner", () => {
  it("shows expired banner", () => {
    const onNewChat = vi.fn();
    render(<ErrorBanner kind="SESSION_EXPIRED" onNewChat={onNewChat} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This chat's session ended");
    fireEvent.click(screen.getByRole("button", { name: "Start new chat" }));
    expect(onNewChat).toHaveBeenCalled();
  });

  it("offers retry for model errors", () => {
    const onRetry = vi.fn();
    render(<ErrorBanner kind="MODEL_ERROR" message="connection refused" onNewChat={vi.fn()} onRetry={onRetry} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("connection refused");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows busy message", () => {
    render(<ErrorBanner kind="THREAD_BUSY" onNewChat={vi.fn()} onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Still working on the last message");
  });
});
