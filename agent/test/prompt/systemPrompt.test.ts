import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/prompt/systemPrompt.js";

describe("buildSystemPrompt", () => {
  it("includes user context and the core rules", () => {
    const p = buildSystemPrompt({ timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" });
    for (const s of ["Asia/Kolkata", "en-IN", "2026-10-27T14:00", "checkout", "show_products", "show_plan", "create_artifact"]) {
      expect(p).toContain(s);
    }
  });

  it("states country and currency from the time zone even when the language says otherwise", () => {
    const p = buildSystemPrompt({ timeZone: "America/Los_Angeles", locale: "en-IN", localTime: "2026-10-27T14:00" });
    expect(p).toContain("Country: US");
    expect(p).toContain("Currency: USD");
  });

  it("tells the model to ask when there is no context", () => {
    expect(buildSystemPrompt(null)).toContain("ask the user");
  });
});
