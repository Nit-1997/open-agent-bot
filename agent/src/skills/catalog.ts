import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir, stripFrontmatter } from "@earendil-works/pi-coding-agent";

export type SkillEntry = { name: string; description: string; body: string };

function packageRoot(from: string): string {
  let dir = from;
  while (!existsSync(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) return from;
    dir = up;
  }
  return dir;
}

export function skillsDir(env: NodeJS.ProcessEnv = process.env, from: string = dirname(fileURLToPath(import.meta.url))): string {
  return env.SKILLS_DIR ? resolve(env.SKILLS_DIR) : join(packageRoot(from), "skills");
}

const WORKSPACE_LINE = /^(\s*)\[workspace\] /;

function forFlags(body: string, workspace: boolean): string {
  return body
    .split("\n")
    .flatMap((line) => (WORKSPACE_LINE.test(line) ? (workspace ? [line.replace(WORKSPACE_LINE, "$1")] : []) : [line]))
    .join("\n");
}

export function loadSkillCatalog(dir: string, opts: { workspace?: boolean } = {}): SkillEntry[] {
  const { skills } = loadSkillsFromDir({ dir, source: "open-agent" });
  return skills
    .filter((s) => s.name && s.description)
    .map((s) => ({ name: s.name, description: s.description, body: forFlags(stripFrontmatter(readFileSync(s.filePath, "utf8")).trim(), opts.workspace === true) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
