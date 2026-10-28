import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/prompt/systemPrompt.js";

describe("buildSystemPrompt", () => {
  it("includes user context and the core rules", () => {
    const p = buildSystemPrompt({ timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" });
    for (const s of ["Asia/Kolkata", "en-IN", "2026-10-27T14:00", "checkout", "show_ui", "unverified", "create_artifact", "ask_user", "start_date", "typical", "nearby airports", "Don't offer driving", "max_layover", "depart_times", "Compare nearby airports?", "Lead with the answer in one sentence", "Only check the weather when", "never mention that you can't buy", "cards block", "even when some have no image", "image_search", "shape \"wide\"", "queries listing every item", "start the card with an image block", "call music once", "call wikipedia once", "even a single product", "one card per item, even without a link or price", "suggest_replies"]) {
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
      profile: { name: "Nitin", home: "Sunnyvale, CA 94087", interests: ["Vegetarian"], notes: "Two cats." },
    });
    expect(p).toContain("Name: Nitin");
    expect(p).toContain("Home: Sunnyvale, CA 94087");
    expect(p).toContain("Interests: Vegetarian");
    expect(p).toContain("Notes: Two cats.");
    expect(p).toMatch(/use their home/i);
  });

  it("leaves the profile section out when there is none", () => {
    expect(buildSystemPrompt({ timeZone: "UTC", locale: "en-US", localTime: "2026-10-27T18:00" })).not.toContain("About the user");
  });
});
