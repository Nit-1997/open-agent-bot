import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SkillEntry } from "../skills/catalog.js";
import { fail, ok, type ToolResult } from "./result.js";

const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function loadSkillTool(skills: () => SkillEntry[]) {
  return defineTool({
    name: "load_skill",
    label: "Load skill",
    description:
      "Load the playbook for a task type listed under Skills in the system prompt. Call it before starting a task that matches a skill, then follow it.",
    parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 64, description: "skill name from the Skills list" }) }),
    async execute(_id, params): Promise<ToolResult> {
      const all = skills();
      const found = NAME.test(params.name) ? all.find((s) => s.name === params.name) : undefined;
      if (!found)
        return fail(`Unknown skill "${params.name.slice(0, 64)}". Available skills: ${all.map((s) => s.name).join(", ") || "none"}.`);
      return ok(found.body, { skill: found.name });
    },
  });
}
