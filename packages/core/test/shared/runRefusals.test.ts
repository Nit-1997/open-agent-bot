import { describe, expect, it } from "vitest";
import { isRunRefusalCode, parseRunRefusal, RUN_REFUSAL_CODES } from "@oab/shared/runRefusals";
import { nextUtcMonth } from "@oab/shared/usage";

const monthly = {
  error: "limit_monthly",
  message: "You've used this month's 50 requests.",
  retryAfter: 2330000,
  retryAt: "2026-12-01T00:00:00.000Z",
  limit: 50,
  used: 50,
  window: "month",
};

describe("parseRunRefusal", () => {
  it("reads the D8 body from the CopilotKit error text", () => {
    expect(parseRunRefusal(`HTTP 429: ${JSON.stringify(monthly)}`)).toEqual({
      code: "limit_monthly",
      message: "You've used this month's 50 requests.",
      retryAfter: 2330000,
      retryAt: "2026-12-01T00:00:00.000Z",
      limit: 50,
      used: 50,
      window: "month",
    });
  });

  it("reads a bare JSON body and keeps only the fields that are present", () => {
    expect(
      parseRunRefusal(JSON.stringify({ error: "human_check_required", message: "Confirm you're human before your first message." })),
    ).toEqual({
      code: "human_check_required",
      message: "Confirm you're human before your first message.",
    });
  });

  it.each(RUN_REFUSAL_CODES)("recognises %s", (code) => {
    expect(parseRunRefusal(`HTTP 429: ${JSON.stringify({ error: code, message: "m" })}`)?.code).toBe(code);
    expect(isRunRefusalCode(code)).toBe(true);
  });

  it.each([
    ["no JSON", "Something went wrong"],
    ["broken JSON", "HTTP 429: {nope"],
    ["an array", "HTTP 429: []"],
    ["another code", `HTTP 429: ${JSON.stringify({ error: "rate_limited", message: "Slow down" })}`],
    ["busy", `HTTP 429: ${JSON.stringify({ error: "busy", message: "busy" })}`],
    ["no message", `HTTP 429: ${JSON.stringify({ error: "limit_running" })}`],
  ])("returns undefined for %s", (_name, text) => {
    expect(parseRunRefusal(text)).toBeUndefined();
  });

  it("drops fields of the wrong type", () => {
    const body = { error: "limit_hourly", message: "m", retryAfter: "40", retryAt: "soon", limit: -1, used: 1.5, window: "day" };
    expect(parseRunRefusal(JSON.stringify(body))).toEqual({ code: "limit_hourly", message: "m" });
  });
});

describe("nextUtcMonth", () => {
  it("is 00:00 UTC on the first of the next month, across a year end", () => {
    expect(nextUtcMonth(Date.parse("2026-11-04T10:00:00Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextUtcMonth(Date.parse("2026-12-31T23:59:59.999Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
