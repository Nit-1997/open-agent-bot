import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, CORE_PROMPT } from "../../src/prompt/systemPrompt.js";

const NAMES = ["amazon", "walmart", "target", "costco", "best buy", "bestbuy", "kroger", "safeway", "shipt", "flipkart", "b&h", "newegg", "google hotels", "airbnb", "booking.com", "expedia", "google flights", "instacart"];
const pattern = new RegExp(`(?<![a-z])(${NAMES.map((n) => n.replace(/[.&]/g, "\\$&")).join("|")})(?![a-z])`, "i");

const skillsDir = new URL("../../skills/", import.meta.url);
const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ name: d.name, body: readFileSync(new URL(`${d.name}/SKILL.md`, skillsDir), "utf8") }));

describe("no store or provider names in the core prompt or skills", () => {
  it("finds none in the v2 core prompt, with or without user context", () => {
    expect(CORE_PROMPT).not.toMatch(pattern);
    const ctx = { timeZone: "Asia/Kolkata", locale: "en-IN", localTime: "2026-10-27T14:00" };
    expect(buildSystemPrompt(ctx, { promptV2: true })).not.toMatch(pattern);
    expect(buildSystemPrompt(null, { promptV2: true })).not.toMatch(pattern);
  });

  it.each(skills.map((s) => [s.name, s.body]))("finds none in the %s skill", (_name, body) => {
    expect(body).not.toMatch(pattern);
  });

  it("checks every skill directory", () => {
    expect(skills.length).toBeGreaterThanOrEqual(7);
  });
});
