import { describe, expect, it } from "vitest";
import { getUserContext } from "@/lib/userContext";

describe("getUserContext", () => {
  it("getUserContext returns tz, locale, local time without Z", () => {
    const ctx = getUserContext(new Date(2026, 9, 27, 14, 5, 9));
    expect(ctx.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(ctx.locale).toBe(navigator.language);
    expect(ctx.localTime).toBe("2026-10-27T14:05:09");
  });
});
