import { describe, expect, it } from "vitest";
import { emptyProfile, parseProfile } from "../../../shared/profile.js";

describe("parseProfile", () => {
  it("fills missing sections so a partial profile is still valid", () => {
    expect(parseProfile({ name: " Nitin " })).toEqual({ ...emptyProfile(), name: "Nitin" });
  });

  it("drops unknown fields, trims and de-duplicates tags, and caps lengths and counts", () => {
    const p = parseProfile({
      extra: "x",
      food: ["Vegan", " vegan ", "", "y".repeat(100), ...Array.from({ length: 30 }, (_, i) => `t${i}`)],
      notes: "n".repeat(5000),
      name: "a".repeat(200),
    });
    expect(p).not.toBeNull();
    expect(p).not.toHaveProperty("extra");
    expect(p?.food.slice(0, 2)).toEqual(["Vegan", "y".repeat(60)]);
    expect(p?.food).toHaveLength(20);
    expect(p?.notes).toHaveLength(1000);
    expect(p?.name).toHaveLength(80);
  });

  it("rejects values of the wrong kind instead of storing them", () => {
    expect(parseProfile("hi")).toBeNull();
    expect(parseProfile({ travel: { style: "first-class" } })).toBeNull();
    expect(parseProfile({ home: { label: "x", lat: 500 } })).toBeNull();
    expect(parseProfile({ skipped: ["you", "nope"] })).toBeNull();
  });

  it("keeps a free-text home with only a label", () => {
    expect(parseProfile({ home: { label: " Somewhere nice " } })?.home).toEqual({ label: "Somewhere nice" });
  });
});
