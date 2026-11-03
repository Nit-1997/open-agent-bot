import { emptyProfile, type Profile } from "@oab/shared/profile";
import { ProfileDrawer } from "@oab/ui/components/profile/ProfileDrawer.tsx";
import type { ModelList } from "@oab/ui/lib/models.ts";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithPlatform } from "../support/platform";

vi.mock("next/navigation", async () => (await import("../support/navigation")).navigationMock());
vi.mock("next/link", async () => (await import("../support/link")).linkMock());

const models: ModelList = {
  default: null,
  models: [
    { id: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "OpenRouter", note: "$0.09 in" },
    { id: "openrouter/anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", provider: "OpenRouter" },
    { id: "groq/llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: "Groq" },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProfileDrawer", () => {
  const profile: Profile = { ...emptyProfile(), name: "Nitin", defaultModel: "groq/llama-3.3-70b-versatile", onboardedAt: "2026-10-30" };

  it("shows the agent group and a sign-out-on-all-devices form, with unique ids, and no recent chats", () => {
    const { container } = renderWithPlatform(
      <ProfileDrawer
        profile={profile}
        models={models}
        onSave={async () => {}}
        onClose={() => {}}
        onRestart={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Your agent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent chats" })).toBeNull();
    const signOut = screen.getByRole("button", { name: "Sign out on all devices" });
    expect(signOut).toHaveAttribute("id", "profile-signout-all");
    const form = signOut.closest("form") as HTMLFormElement;
    expect(form).toHaveAttribute("action", "/auth/signout");
    expect(form).toHaveAttribute("method", "post");
    expect(new FormData(form).get("scope")).toBe("global");
    const ids = [...container.querySelectorAll("*")].filter((e) => e.namespaceURI === "http://www.w3.org/1999/xhtml").map((e) => e.id);
    expect(ids.filter((id) => !id)).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
