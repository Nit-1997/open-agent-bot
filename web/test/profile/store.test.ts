import { emptyProfile } from "@shared/profile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearedProfile, initials, loadProfile, resetProfileStore, saveProfile } from "@/lib/profile";

afterEach(() => {
  vi.unstubAllGlobals();
  resetProfileStore();
});

describe("profile store", () => {
  it("loads the profile from the agent and saves it with PUT, not local storage", async () => {
    const stored = { ...emptyProfile(), name: "Nitin" };
    const fetchMock = vi.fn(async (_u: string, init: RequestInit = {}) =>
      init.method === "PUT"
        ? new Response(JSON.stringify({ profile: JSON.parse(String(init.body)).profile }))
        : new Response(JSON.stringify({ profile: stored })),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadProfile()).toEqual(stored);
    await saveProfile({ ...stored, food: ["Vegan"] });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/profile");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
    expect(localStorage.getItem("open-agent.profile")).toBeNull();
  });

  it("surfaces an unreachable agent instead of pretending the profile is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "The agent isn't reachable." }), { status: 502 })),
    );
    expect(await loadProfile()).toBeNull();
    await expect(saveProfile(emptyProfile())).rejects.toThrow("The agent isn't reachable.");
  });

  it("clearing keeps the chosen model, finished onboarding and the agent", () => {
    const p = { ...emptyProfile(), name: "N", food: ["Vegan"], defaultModel: "a/b", onboardedAt: "t", agent: { name: "Ivy" } };
    expect(clearedProfile(p)).toEqual({ ...emptyProfile(), defaultModel: "a/b", onboardedAt: "t", agent: { name: "Ivy" } });
    expect(initials(" nitin  bhat ")).toBe("NB");
  });
});
