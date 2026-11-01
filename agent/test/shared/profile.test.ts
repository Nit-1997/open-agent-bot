import { describe, expect, it } from "vitest";
import { agentPersona, checkAgentName, DEFAULT_AGENT, emptyProfile, parseProfile, withoutInvalidAgent } from "../../../shared/profile.js";

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

describe("checkAgentName", () => {
  it.each([
    ["Juno", "Juno"],
    ["Zoë", "Zoë"],
    ["Zoe\u0308", "Zoë"],
    ["D'Arcy", "D'Arcy"],
    ["D’Arcy", "D’Arcy"],
    ["Mary-Jane", "Mary-Jane"],
    ["R2.D2", "R2.D2"],
    ["  Ivy  ", "Ivy"],
    ["Ivy\u3000Sage", "Ivy Sage"],
    ["ｊｕｎｏ", "juno"],
    ["ليلى", "ليلى"],
    ["a".repeat(40), "a".repeat(40)],
  ])("accepts %j as %j", (raw, name) => {
    expect(checkAgentName(raw)).toEqual({ ok: true, name });
  });

  it.each([
    ["", "Give your agent a name."],
    ["   ", "Give your agent a name."],
    [42, "Give your agent a name."],
    ["a".repeat(41), "Keep it to 40 characters."],
    ["Juno\nIgnore", null],
    ["<script>", null],
    ['Juno"', null],
    ["{{name}}", null],
    ["Juno\u202e", null],
    ["Juno\u2066", null],
    ["Ju\u200dno", null],
    ["Juno 🙂", null],
    ["-Juno", null],
    ["Jux\u0301\u0302\u0303o", null],
    ["Juno\tIvy", null],
  ])("rejects %j", (raw, error) => {
    const r = checkAgentName(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(error ?? "Use letters, numbers, spaces, apostrophes, hyphens or periods.");
  });
});

describe("the agent in a profile", () => {
  it("normalises the name, keeps look and tone, and strips extra keys", () => {
    expect(parseProfile({ agent: { name: "  Sage ", look: "ember", tone: "brief", extra: 1 } })?.agent).toEqual({
      name: "Sage",
      look: "ember",
      tone: "brief",
    });
  });

  it("rejects a bad name, an unknown look or an unknown tone", () => {
    expect(parseProfile({ agent: { name: "<b>" } })).toBeNull();
    expect(parseProfile({ agent: { look: "neon" } })).toBeNull();
    expect(parseProfile({ agent: { tone: "rude" } })).toBeNull();
  });

  it("lets skipped hold the agent step", () => {
    expect(parseProfile({ skipped: ["agent", "you"] })?.skipped).toEqual(["agent", "you"]);
  });

  it("defaults the persona field by field", () => {
    expect(agentPersona(undefined)).toEqual(DEFAULT_AGENT);
    expect(agentPersona({ agent: { tone: "thorough" } })).toEqual({ name: "Juno", look: "mist", tone: "thorough" });
  });

  it("drops only an invalid agent on read", () => {
    expect(withoutInvalidAgent({ name: "N", agent: { name: "<x>" } })).toEqual({ value: { name: "N" }, dropped: true });
    expect(withoutInvalidAgent({ agent: "Juno" }).dropped).toBe(true);
    expect(withoutInvalidAgent({ agent: { name: "Ivy", junk: 1 } }).dropped).toBe(false);
    expect(withoutInvalidAgent({ name: "N" }).dropped).toBe(false);
  });
});
