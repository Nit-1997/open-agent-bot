import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/prompt/systemPrompt.js";

describe("buildSystemPrompt", () => {
  it("includes user context and the core rules", () => {
    const p = buildSystemPrompt({ timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" });
    for (const s of ["Asia/Kolkata", "en-IN", "2026-10-27T14:00", "checkout", "show_widget", "create_artifact"]) {
      expect(p).toContain(s);
    }
  });

  it("tells the model to ask when there is no context", () => {
    expect(buildSystemPrompt(null)).toContain("ask the user");
  });
});
