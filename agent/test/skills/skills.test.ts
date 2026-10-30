import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_GUIDE } from "../../src/artifacts/reportKit.js";
import { CORE_PROMPT, buildSystemPrompt, skillIndex } from "../../src/prompt/systemPrompt.js";
import { loadSkillCatalog, skillsDir } from "../../src/skills/catalog.js";
import { loadSkillTool } from "../../src/tools/loadSkill.js";

const NAMES = ["dining-out", "gift-ideas", "grocery-run", "music", "party-planning", "research", "trip-planning"];
const run = (skills: ReturnType<typeof loadSkillCatalog>, name: string) =>
  loadSkillTool(() => skills).execute("c", { name }, undefined, undefined, {} as never);
const text = (r: { content: { text: string }[] }) => r.content[0].text;

function dummy(dir: string, name: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Load for pet grooming questions.\n---\n\n# Grooming\n\nBrush daily.\n`,
  );
}

describe("skills directory", () => {
  it("resolves from src and from the Docker dist layout", () => {
    const root = mkdtempSync(join(tmpdir(), "pkg-"));
    writeFileSync(join(root, "package.json"), "{}");
    const src = join(root, "src", "skills");
    const dist = join(root, "dist", "agent", "src", "skills");
    mkdirSync(src, { recursive: true });
    mkdirSync(dist, { recursive: true });
    expect(skillsDir({}, src)).toBe(join(root, "skills"));
    expect(skillsDir({}, dist)).toBe(join(root, "skills"));
  });

  it("resolves the real skills from the source tree and honors SKILLS_DIR", () => {
    expect(loadSkillCatalog(skillsDir({})).map((s) => s.name)).toEqual(NAMES);
    expect(skillsDir({ SKILLS_DIR: "/tmp/x" })).toBe("/tmp/x");
  });

  it("every shipped skill has a description saying when to load it and a body without frontmatter", () => {
    for (const s of loadSkillCatalog(skillsDir({}))) {
      expect(s.description).toMatch(/^Load (for|when)/);
      expect(s.body.startsWith("---")).toBe(false);
      expect(s.body.length).toBeGreaterThan(200);
    }
  });
});

describe("codemode skills", () => {
  const catalog = (codemode: boolean) => loadSkillCatalog(skillsDir({}), { codemode });

  it("lists the judging skill only when codemode is available", () => {
    expect(catalog(false).map((s) => s.name)).not.toContain("judging");
    expect(catalog(true).map((s) => s.name)).toContain("judging");
    expect(skillIndex(catalog(false))).not.toContain("judging");
  });

  it("shows the party budget line only when codemode is available", () => {
    const body = (c: boolean) => catalog(c).find((s) => s.name === "party-planning")!.body;
    expect(body(false)).not.toContain("codemode");
    expect(body(true)).toContain("codemode script");
    expect(body(true)).not.toContain("[codemode]");
  });
});

describe("planning skills", () => {
  const body = (name: string) => loadSkillCatalog(skillsDir({})).find((x) => x.name === name)!.body;

  it("record plans in the workspace and point research at the research tool", () => {
    for (const name of ["party-planning", "trip-planning"]) expect(body(name)).toContain("plan set");
    expect(body("party-planning")).toContain("plan patch guests");
    expect(body("trip-planning")).toContain("Follow-ups patch it");
    expect(body("research")).toContain("When the research tool is listed");
    for (const name of ["party-planning", "trip-planning", "research"]) expect(body(name)).not.toMatch(/\[(workspace|rpiv)\]/);
  });
});

describe("skill content", () => {
  const by = Object.fromEntries(loadSkillCatalog(skillsDir({})).map((s) => [s.name, s.body]));

  it("research carries the report kit create_artifact no longer describes", () => {
    expect(by.research).toContain(REPORT_GUIDE);
  });

  it("trip planning keeps the flight preference fields and their mapping", () => {
    for (const s of ["Compare nearby airports?", "Layovers", "Departure time", "max_layover", "depart_times", "early_morning"])
      expect(by["trip-planning"]).toContain(s);
  });

  it("grocery and party skills keep pantry basics, cart edits, and the budget math", () => {
    expect(by["grocery-run"]).toContain("pantry basics");
    expect(by["grocery-run"]).toContain("new_cart");
    expect(by["party-planning"]).toMatch(/budget/i);
    expect(by["party-planning"]).toContain("timeline");
  });
});

describe("system prompt", () => {
  const skills = loadSkillCatalog(skillsDir({}));

  it("keeps the core under 2,000 characters", () => {
    expect(CORE_PROMPT.length).toBeLessThan(2000);
  });

  it("lists every skill in the index after the core", () => {
    const p = buildSystemPrompt(null, skills);
    expect(p.startsWith(CORE_PROMPT)).toBe(true);
    for (const s of skills) expect(p).toContain(`- ${s.name}: ${s.description}`);
    expect(p).toContain("call load_skill");
    expect(skillIndex([])).toBe("");
  });

  it("names no hard-coded Bay Area airports", () => {
    expect(buildSystemPrompt(null, skills)).not.toMatch(/SJC|SFO|OAK|Bay Area/);
  });

  it("keeps the user context", () => {
    const ctx = {
      timeZone: "America/Los_Angeles",
      locale: "en-US",
      localTime: "2026-10-27T18:00",
      profile: { name: "Nitin", home: { label: "Sunnyvale, CA 94087", city: "Sunnyvale", region: "CA", country: "US" } },
    };
    const p = buildSystemPrompt(ctx, skills);
    expect(p).toContain("Country: US");
    expect(p).toContain("Home: Sunnyvale, CA, US");
  });

  it("picks up a new skill directory with no code change", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skills-"));
    for (const n of NAMES) dummy(dir, n);
    dummy(dir, "pet-care");
    const found = loadSkillCatalog(skillsDir({ SKILLS_DIR: dir }));
    expect(buildSystemPrompt(null, found)).toContain("- pet-care: Load for pet grooming questions.");
    expect(text(await run(found, "pet-care"))).toBe("# Grooming\n\nBrush daily.");
  });
});

describe("load_skill", () => {
  const skills = loadSkillCatalog(skillsDir({}));

  it("returns the body of a known skill without frontmatter", async () => {
    const r = await run(skills, "research");
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("create_artifact");
    expect(text(r)).not.toContain("description:");
  });

  it("lists the available names for an unknown skill", async () => {
    const r = await run(skills, "nope");
    expect(r.isError).toBe(true);
    for (const n of NAMES) expect(text(r)).toContain(n);
  });

  it("rejects path-like names", async () => {
    for (const n of [
      "../package",
      "../../etc/passwd",
      "research/SKILL.md",
      "/etc/passwd",
      "research\\..",
      "Research",
      "research\0",
      "..",
      "",
    ]) {
      const r = await run(skills, n);
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("Unknown skill");
    }
  });
});
