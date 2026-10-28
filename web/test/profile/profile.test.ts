import { beforeEach, describe, expect, it } from "vitest";
import { clearProfile, EMPTY_PROFILE, initials, loadProfile, saveProfile } from "@/lib/profile";

describe("profile storage", () => {
  beforeEach(() => localStorage.clear());

  it("starts empty and not onboarded", () => {
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it("round-trips what was saved", () => {
    const p = { ...EMPTY_PROFILE, name: "Nitin", home: "94087", interests: ["Has pets"], onboarded: true };
    saveProfile(p);
    expect(loadProfile()).toEqual(p);
  });

  it("survives corrupt or partial storage", () => {
    localStorage.setItem("open-agent.profile", "{not json");
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
    localStorage.setItem("open-agent.profile", JSON.stringify({ name: 5, interests: "x", onboarded: true }));
    expect(loadProfile()).toEqual({ ...EMPTY_PROFILE, onboarded: true });
  });

  it("clears back to empty", () => {
    saveProfile({ ...EMPTY_PROFILE, name: "A", onboarded: true });
    clearProfile();
    expect(loadProfile()).toEqual(EMPTY_PROFILE);
  });

  it("makes initials from the name", () => {
    expect(initials("Nitin Bhat")).toBe("NB");
    expect(initials("  ")).toBe("");
    expect(initials("nitin")).toBe("N");
  });
});
