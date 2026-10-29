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

const CODEMODE_ONLY = new Set(["judging"]);

const FLAG_LINE = /^(\s*)\[(workspace|rpiv|codemode)\] /;

function forFlags(body: string, flags: Record<string, boolean>): string {
  return body
    .split("\n")
    .flatMap((line) => {
      const m = FLAG_LINE.exec(line);
      return m ? (flags[m[2]] ? [line.replace(FLAG_LINE, "$1")] : []) : [line];
    })
    .join("\n");
}

export function loadSkillCatalog(dir: string, opts: { workspace?: boolean; rpiv?: boolean; codemode?: boolean } = {}): SkillEntry[] {
  const { skills } = loadSkillsFromDir({ dir, source: "open-agent" });
  return skills
    .filter((s) => s.name && s.description && (opts.codemode === true || !CODEMODE_ONLY.has(s.name)))
    .map((s) => ({ name: s.name, description: s.description, body: forFlags(stripFrontmatter(readFileSync(s.filePath, "utf8")).trim(), { workspace: opts.workspace === true, rpiv: opts.rpiv === true, codemode: opts.codemode === true }) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
