import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "../../../shared/profile.js";
import { profileLines } from "../../src/profile/prompt.js";
import { buildSystemPrompt } from "../../src/prompt/systemPrompt.js";

const full: Profile = {
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
  household: { partner: true, kids: ["4–8"], pets: ["Dog"], other: [] },
  food: ["Vegetarian", "Nut allergy"],
  travel: {
    style: "comfort",
    airlines: ["Southwest"],
    stays: ["hotel", "rental"],
    hotelChains: ["Marriott"],
    sites: ["Google Flights", "Airbnb"],
  },
  shopping: { style: "balanced", groceries: ["Trader Joe's", "Costco"], retail: ["Amazon"], delivery: ["Instacart", "None"] },
};

describe("profileLines", () => {
  it("writes one short line per area", () => {
    expect(profileLines(full)).toEqual([
      "- Name: Nitin",
      "- Home: San Francisco, California, US",
      "- Household: partner; kids 4–8; pets: dog",
      "- Food: Vegetarian, Nut allergy",
      "- Travel: comfort; airlines Southwest; stays hotels, vacation rentals; hotel chains Marriott; books on Google Flights, Airbnb",
      "- Shopping: balanced spender; groceries from Trader Joe's, Costco; also shops at Amazon; delivery apps Instacart",
    ]);
  });

  it("never puts the street address in the prompt", () => {
    const prompt = buildSystemPrompt({ timeZone: "America/Los_Angeles", locale: "en-US", localTime: "t", profile: full });
    expect(prompt).not.toContain("555");
    expect(prompt).not.toContain("California St");
  });

  it("leaves out a home that only has free text, since it may be a street address", () => {
    const lines = profileLines({ ...emptyProfile(), home: { label: "12 Rue de Rivoli, flat 3" } });
    expect(lines.join("\n")).not.toContain("Rivoli");
    expect(lines).toEqual([]);
  });

  it("says when the user has no food restrictions and skips empty areas", () => {
    expect(profileLines({ ...emptyProfile(), food: ["No restrictions"] })).toEqual(["- Food: no restrictions"]);
    expect(profileLines(emptyProfile())).toEqual([]);
  });
});
