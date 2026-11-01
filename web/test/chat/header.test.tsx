import { emptyProfile } from "@shared/profile";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("puts the profile, Admin and a local sign-out behind the initials", async () => {
    const { container } = render(<Chat email="ntn@example.test" name="" isAdmin />);
    const trigger = await screen.findByRole("button", { name: "Account" });
    expect(trigger).toHaveTextContent("N");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toHaveTextContent("ntn@example.test");
    expect(screen.getByRole("menuitem", { name: "Admin" })).toHaveAttribute("href", "/admin");
    const signOut = screen.getByRole("menuitem", { name: "Sign out" });
    const form = signOut.closest("form") as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(new FormData(form).get("scope")).toBe("local");
    expectUniqueIds(container);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the profile drawer from the menu", async () => {
    render(<Chat email="ntn@example.test" name="" isAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Profile & settings" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("hides the Admin item from other users", async () => {
    render(<Chat email="user@example.test" name="" isAdmin={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    expect(screen.queryByRole("menuitem", { name: "Admin" })).toBeNull();
  });

  it("uses the sign-in name for initials when the profile has none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/profile") return Response.json({ profile: { ...emptyProfile(), onboardedAt: "2026-10-30" } });
        if (url === "/api/models") return Response.json({ default: null, models: [] });
        return Response.json({ error: "not_found" }, { status: 404 });
      }),
    );
    render(<Chat email="sb@example.test" name="Shrishtika Bora" isAdmin={false} />);
    expect(await screen.findByRole("button", { name: "Account" })).toHaveTextContent("SB");
  });

  it("prefers the saved profile name over the sign-in name", async () => {
    render(<Chat email="ntn@example.test" name="Someone Else" isAdmin={false} />);
    expect(await screen.findByRole("button", { name: "Account" })).toHaveTextContent(/^N$/);
  });

  it("shows a sign-in banner after signed_out and a full page after account_disabled", async () => {
    const { container } = render(<Chat email="user@example.test" name="" isAdmin={false} />);
    await screen.findByRole("button", { name: "Account" });
    act(() => noteAuthFailure(401, "signed_out"));
    expect(screen.getByRole("alert")).toHaveTextContent("You were signed out. Sign in again.");
    expectUniqueIds(container);
    act(() => noteAuthFailure(403, "account_disabled"));
    expect(screen.getByRole("alert")).toHaveTextContent("Your access has been turned off.");
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expectUniqueIds(container);
  });
});
