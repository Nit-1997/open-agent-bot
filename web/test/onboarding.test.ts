import { emptyProfile, type Profile } from "@oab/shared/profile";
import { describe, expect, it } from "vitest";
import {
  addTag,
  browserCountry,
  detectedLine,
  jevProvider,
  optionsQuery,
  slideOrder,
  starters,
  summaryLines,
  toggle,
  travelers,
} from "@/lib/onboarding";

describe("slideOrder", () => {
  it("asks for the model just before the summary, or first when nothing is set up", () => {
    expect(slideOrder({ modelFirst: false, showJev: true })).toEqual(["agent", "you", "travel", "shopping", "jev", "model", "summary"]);
    expect(slideOrder({ modelFirst: true, showJev: false })).toEqual(["agent", "model", "you", "travel", "shopping", "summary"]);
  });
});

describe("chips", () => {
  it("toggles, and an exclusive chip clears the rest", () => {
    expect(toggle(["A"], "B")).toEqual(["A", "B"]);
    expect(toggle(["A", "B"], "A")).toEqual(["B"]);
    expect(toggle(["A", "B"], "None", ["None"])).toEqual(["None"]);
    expect(toggle(["None"], "A", ["None"])).toEqual(["A"]);
  });

  it("adds trimmed, short, unique tags", () => {
    expect(addTag(["Vegan"], "  vegan ")).toEqual(["Vegan"]);
    expect(addTag([], "   ")).toEqual([]);
    expect(addTag(["None"], "x".repeat(80), ["None"])).toEqual(["x".repeat(60)]);
  });
});

describe("options query and detected line", () => {
  it("sends lat/lon and country, or the browser's region before a home is chosen", () => {
    expect(optionsQuery({ label: "x", lat: 37.791234, lon: -122.4, country: "US" })).toBe("lat=37.7912&lon=-122.4000&country=US");
    expect(optionsQuery(undefined, "en-IN")).toBe("country=IN");
    expect(optionsQuery({ label: "free text" }, "en")).toBe("");
    expect(browserCountry("pt_br")).toBe("BR");
  });

  it("shows city, currency, units and airports once a place was picked", () => {
    const opts = {
      country: "US",
      currency: "USD",
      units: "imperial" as const,
      airports: ["SFO"],
      groceriesNearby: false,
      rows: {} as never,
    };
    expect(detectedLine({ label: "x", city: "San Francisco" }, opts)).toBe("San Francisco · USD · °F · airports SFO");
    expect(detectedLine({ label: "free text" }, opts)).toBeNull();
  });
});

const family: Profile = {
  ...emptyProfile(),
  name: "Nitin",
  home: { label: "555 California St", city: "San Francisco", region: "CA", country: "US" },
  household: { partner: true, kids: ["4–8"], pets: [], other: [] },
  food: ["Vegetarian", "Nut allergy"],
  shopping: { style: "balanced", groceries: ["Trader Joe's"], retail: [], delivery: ["None"] },
};

describe("summary and starters", () => {
  it("writes one line per section, says when one was skipped, and shows Jev only when asked about", () => {
    const lines = summaryLines({ ...family, skipped: ["travel"] }, { jev: "OpenRouter", modelLabel: "DeepSeek" });
    expect(lines.map((l) => `${l.label}: ${l.text}`)).toEqual([
      "Your agent: Juno · warm · mist look",
      "You: Nitin · San Francisco, CA",
      "Household: partner, kids 4–8 · vegetarian · nut allergy",
      "Travel: skipped",
      "Shopping: balanced · Trader Joe's",
      "Jev: on (OpenRouter)",
      "Model: DeepSeek",
    ]);
    expect(summaryLines(emptyProfile()).map((l) => l.label)).not.toContain("Jev");
    expect(summaryLines(emptyProfile(), { jev: null }).find((l) => l.label === "Jev")?.text).toBe("off");
  });

  it("never shows the street address of a picked place in the summary", () => {
    expect(summaryLines(family)[1].text).not.toContain("California St");
  });

  it("builds starters from the answers", () => {
    expect(travelers(family)).toBe(3);
    expect(starters(family, ["SFO"])).toEqual([
      "Weekend trip from SFO for the 3 of us",
      "Veggie taco night at Trader Joe's",
      "Nut-free birthday party for a 6-year-old",
    ]);
    expect(starters(emptyProfile(), [])).toEqual(["Weekend trip for me", "Taco night", "Cheap eats near me this weekend"]);
  });

  it("names the Jev provider, TypeSafe first", () => {
    const list = [
      { id: "openrouter", label: "OpenRouter", configured: true },
      { id: "typesafe", label: "TypeSafe", configured: true },
    ];
    expect(jevProvider(list)).toBe("TypeSafe");
    expect(jevProvider([{ id: "openrouter", label: "OpenRouter", configured: false }])).toBeNull();
  });
});
