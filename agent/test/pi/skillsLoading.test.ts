import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPiSession } from "../../src/pi/createPiSession.js";
import { ProviderHub } from "../../src/providers/hub.js";
import { loadSkillCatalog, skillsDir } from "../../src/skills/catalog.js";
import { CORE_PROMPT, buildSystemPrompt } from "../../src/prompt/systemPrompt.js";
import { loadSkillTool } from "../../src/tools/loadSkill.js";

async function open(skills?: string) {
  const hub = await ProviderHub.create({
    dataDir: mkdtempSync(join(tmpdir(), "skills-")),
    litellm: { baseUrl: "http://127.0.0.1:1", apiKey: "none", models: [{ id: "m", label: "m" }] },
  });
  const model = hub.resolve("litellm/m") ?? hub.resolve("m");
  if (!model) throw new Error("no model");
  const catalog = loadSkillCatalog(skillsDir());
  return createPiSession({
    runtime: hub.runtime,
    model,
    systemPrompt: buildSystemPrompt(null, { promptV2: true, skills: catalog }),
    tools: [loadSkillTool(() => catalog)],
    ...(skills && { skillsDir: skills }),
  });
}

describe("pi skill loading", () => {
  it("keeps our prompt as is: pi adds no skill listing when no file reader tool exists", async () => {
    const handle = await open(skillsDir());
    try {
      const p = handle.session.systemPrompt;
      expect(p).toContain(CORE_PROMPT);
      expect(p).not.toContain("<available_skills>");
      expect(p.match(/trip-planning/g)?.length).toBe(1);
      expect(handle.session.getActiveToolNames()).toEqual(["load_skill"]);
    } finally {
      await handle.dispose();
    }
  });

  it("legacy path loads no skills", async () => {
    const handle = await open();
    try {
      expect(handle.session.resourceLoader.getSkills().skills).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });

  it("registers the skills directory with pi's resource loader", async () => {
    const handle = await open(skillsDir());
    try {
      const names = handle.session.resourceLoader.getSkills().skills.map((s) => s.name).sort();
      expect(names).toEqual(loadSkillCatalog(skillsDir(), { codemode: true }).map((s) => s.name));
    } finally {
      await handle.dispose();
    }
  });
});
