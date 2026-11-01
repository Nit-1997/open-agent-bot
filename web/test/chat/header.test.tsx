import { emptyProfile } from "@shared/profile";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "@/components/Chat";
import { noteAuthFailure, resetAuthState } from "@/lib/authState";
import { resetProfileStore } from "@/lib/profile";

vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: () => {} }));
vi.mock("@/components/chat/ChatSession", () => ({ ChatSession: () => <div id="chat-session-stub" /> }));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/profile") return Response.json({ profile: { ...emptyProfile(), name: "Nitin", onboardedAt: "2026-10-30" } });
      if (url === "/api/models") return Response.json({ default: null, models: [] });
      return Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProfileStore();
  resetAuthState();
});

const expectUniqueIds = (root: HTMLElement) => {
  const ids = [...root.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
  expect(ids.filter((id) => !id)).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
};

describe("Chat header", () => {
  it("shows the email, an Admin link for admins and a local sign-out", async () => {
    const { container } = render(<Chat email="ntn@example.test" isAdmin />);
    expect(await screen.findByText("ntn@example.test")).toHaveAttribute("id", "header-email");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("id", "header-admin-link");
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(signOut).toHaveAttribute("id", "header-signout");
    const form = signOut.closest("form") as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(new FormData(form).get("scope")).toBe("local");
    expectUniqueIds(container);
  });

  it("hides the Admin link from other users", async () => {
    render(<Chat email="user@example.test" isAdmin={false} />);
    await screen.findByText("user@example.test");
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("shows a sign-in banner after signed_out and a full page after account_disabled", async () => {
    const { container } = render(<Chat email="user@example.test" isAdmin={false} />);
    await screen.findByText("user@example.test");
    act(() => noteAuthFailure(401, "signed_out"));
    expect(screen.getByRole("alert")).toHaveTextContent("You were signed out. Sign in again.");
    expectUniqueIds(container);
    act(() => noteAuthFailure(403, "account_disabled"));
    expect(screen.getByRole("alert")).toHaveTextContent("Your access has been turned off.");
    expect(screen.queryByText("user@example.test")).toBeNull();
    expectUniqueIds(container);
  });
});
