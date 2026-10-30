import { describe, expect, it } from "vitest";
import { matchingImage } from "../../src/tools/webSearch.js";

const hit = (title: string, image = `https://i.com/${encodeURIComponent(title)}.jpg`) => ({ title, url: "https://p.com", image });

describe("matchingImage", () => {
  it("skips pictures whose page title has little to do with the item", () => {
    const hits = [hit("A Wiltshire thatcher"), hit("Paddy fields in Bali"), hit("Mahatma Long Grain White Rice, 5 lb bag")];
    expect(matchingImage("Long grain white rice", hits)).toBe(hits[2].image);
  });

  it("returns nothing when no result matches well", () => {
    expect(matchingImage("Black beans, canned", [hit("Fried fish on rice"), hit("Taco night")])).toBeUndefined();
  });

  it("ignores sizes and filler words when matching", () => {
    expect(
      matchingImage("Boneless skinless chicken breast, ~2 lbs", [hit("Foster Farms Boneless Skinless Chicken Breasts")]),
    ).toBeDefined();
  });
});
