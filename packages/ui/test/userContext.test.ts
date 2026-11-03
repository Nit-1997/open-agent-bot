import { describe, expect, it } from "vitest";
import { getUserContext } from "../src/lib/userContext.ts";

describe("getUserContext", () => {
  it("getUserContext returns tz, locale, local time without Z", () => {
    const ctx = getUserContext(new Date(2026, 9, 27, 14, 5, 9));
    expect(ctx.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(ctx.locale).toBe(navigator.language);
    expect(ctx.localTime).toBe("2026-10-27T14:05:09");
    expect(ctx.viewport).toEqual({ width: window.innerWidth, height: window.innerHeight });
  });
});

describe("getUserContext with a chat model", () => {
  it("adds the chat's model and never the profile, which the agent reads itself", () => {
    const ctx = getUserContext(new Date(2026, 9, 27, 14, 5, 9), { model: "openrouter/x/y" });
    expect(ctx.model).toBe("openrouter/x/y");
    expect(ctx).not.toHaveProperty("profile");
    expect(getUserContext(new Date())).not.toHaveProperty("model");
  });
});
