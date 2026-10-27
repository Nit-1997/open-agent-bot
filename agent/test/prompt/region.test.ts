import { describe, expect, it } from "vitest";
import { regionFor } from "../../src/prompt/region.js";

describe("regionFor", () => {
  it("prefers the time zone over the browser language", () => {
    expect(regionFor({ timeZone: "America/Los_Angeles", locale: "en-IN", localTime: "" })).toEqual({ country: "US", currency: "USD" });
    expect(regionFor({ timeZone: "Asia/Kolkata", locale: "en-US", localTime: "" })).toEqual({ country: "IN", currency: "INR" });
  });

  it("covers common zones", () => {
    expect(regionFor({ timeZone: "America/Chicago", locale: "en", localTime: "" }).currency).toBe("USD");
    expect(regionFor({ timeZone: "Pacific/Honolulu", locale: "en", localTime: "" }).currency).toBe("USD");
    expect(regionFor({ timeZone: "America/Toronto", locale: "en", localTime: "" }).currency).toBe("CAD");
    expect(regionFor({ timeZone: "Europe/London", locale: "en", localTime: "" }).currency).toBe("GBP");
    expect(regionFor({ timeZone: "Europe/Paris", locale: "fr", localTime: "" }).currency).toBe("EUR");
    expect(regionFor({ timeZone: "Australia/Sydney", locale: "en", localTime: "" }).currency).toBe("AUD");
  });

  it("falls back to the locale region, then US", () => {
    expect(regionFor({ timeZone: "Etc/UTC", locale: "en-GB", localTime: "" })).toEqual({ country: "GB", currency: "GBP" });
    expect(regionFor({ timeZone: "Etc/UTC", locale: "en", localTime: "" })).toEqual({ country: "US", currency: "USD" });
    expect(regionFor(null)).toEqual({ country: "US", currency: "USD" });
  });
});
