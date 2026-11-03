import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "@oab/shared/profile";
import { buildSystemPrompt } from "../../src/prompt/systemPrompt.js";

const profile: Profile = {
  ...emptyProfile(),
  name: "Nitin",
  home: {
    label: "555 California St, San Francisco, CA",
    city: "San Francisco",
    region: "California",
    country: "US",
    lat: 37.79,
    lon: -122.4,
  },
  food: ["Vegetarian"],
};

describe("buildSystemPrompt", () => {
  it("includes user context and the core rules", () => {
    const p = buildSystemPrompt({ timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" });
    for (const s of [
      "Asia/Kolkata",
      "en-IN",
      "2026-10-27T14:00",
      "Country: IN",
      "Currency: INR",
      "checkout",
      "unverified",
      "ask_user",
      "<followups>",
    ]) {
      expect(p).toContain(s);
    }
  });

  it("states country and currency from the time zone even when the language says otherwise", () => {
    const p = buildSystemPrompt({ timeZone: "America/Los_Angeles", locale: "en-IN", localTime: "2026-10-27T14:00" });
    expect(p).toContain("Country: US");
    expect(p).toContain("Currency: USD");
  });

  it("says the time zone gives the country, not the city", () => {
    const p = buildSystemPrompt({ timeZone: "America/Los_Angeles", locale: "en-IN", localTime: "2026-10-27T14:00" });
    expect(p).toContain("not the city");
    expect(p).not.toContain("Los Angeles weather");
  });

  it("tells the model to ask when there is no context", () => {
    expect(buildSystemPrompt(null)).toContain("ask the user");
  });

  it("includes the user's profile and uses their home instead of asking", () => {
    const p = buildSystemPrompt({
      timeZone: "America/Los_Angeles",
      locale: "en-US",
      localTime: "2026-10-27T18:00",
      profile: { ...profile, notes: "Two cats." },
    });
    expect(p).toContain("Name: Nitin");
    expect(p).toContain("Home: San Francisco, California, US");
    expect(p).toContain("Food: Vegetarian");
    expect(p).toContain("Notes: Two cats.");
    expect(p).toContain("Country: US (from their home address)");
    expect(p).toMatch(/use their home/i);
  });

  it("leaves the profile section out when there is none", () => {
    expect(buildSystemPrompt({ timeZone: "UTC", locale: "en-US", localTime: "2026-10-27T18:00" })).not.toContain("About the user");
  });
});
