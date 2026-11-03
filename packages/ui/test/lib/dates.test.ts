import { describe, expect, it } from "vitest";
import { cardDate } from "@/lib/dates";

describe("cardDate", () => {
  const now = new Date(2026, 10, 1, 18, 0);

  it("shows the time on the same day, month and day in the same year, and the year otherwise", () => {
    expect(cardDate(new Date(2026, 10, 1, 15, 10).toISOString(), "en-US", now)).toBe("3:10 PM");
    expect(cardDate(new Date(2026, 9, 28, 9, 0).toISOString(), "en-US", now)).toBe("Oct 28");
    expect(cardDate(new Date(2025, 10, 1, 9, 0).toISOString(), "en-US", now)).toBe("Nov 1, 2025");
  });

  it("gives null for a missing or invalid date", () => {
    expect(cardDate("not a date", "en-US", now)).toBeNull();
    expect(cardDate(null, "en-US", now)).toBeNull();
    expect(cardDate(undefined, "en-US", now)).toBeNull();
  });
});
