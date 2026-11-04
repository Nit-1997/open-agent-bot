import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const json = <T>(path: string) => JSON.parse(read(path)) as T;

function workspaceDirs(): string[] {
  const { workspaces } = json<{ workspaces: string[] }>("package.json");
  return workspaces
    .filter((glob) => !glob.startsWith("cloud/"))
    .flatMap((glob) => {
      if (!glob.endsWith("/*")) return [glob];
      const parent = glob.slice(0, -2);
      return readdirSync(join(ROOT, parent), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(ROOT, parent, d.name, "package.json")))
        .map((d) => `${parent}/${d.name}`);
    });
}

const DOCKERFILES = ["packages/core/Dockerfile"];

describe("workspace layout", () => {
  const dirs = workspaceDirs();

  it("finds every workspace package", () => {
    expect(dirs).toEqual(expect.arrayContaining(["packages/core", "packages/shared", "e2e"]));
  });

  it.each(DOCKERFILES)("%s copies every workspace package.json before npm ci", (dockerfile) => {
    const text = read(dockerfile);
    const ci = text.indexOf("RUN npm ci");
    expect(ci).toBeGreaterThan(0);
    for (const dir of dirs) {
      const copy = text.indexOf(`COPY ${dir}/package.json ${dir}/`);
      expect(copy, `${dockerfile} must copy ${dir}/package.json`).toBeGreaterThan(-1);
      expect(copy).toBeLessThan(ci);
    }
  });

  it.each(DOCKERFILES)("%s names no cloud/ path", (dockerfile) => {
    expect(read(dockerfile)).not.toMatch(/(^|[\s./])cloud\//m);
  });

  it.each([["packages/core/tsconfig.json", "packages/core"]])("%s points typebox paths at files that exist", (tsconfig, base) => {
    const { compilerOptions } = json<{ compilerOptions: { paths: Record<string, string[]> } }>(tsconfig);
    const targets = Object.entries(compilerOptions.paths)
      .filter(([key]) => key.startsWith("typebox"))
      .flatMap(([, values]) => values);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(join(ROOT, base, target)), target).toBe(true);
  });

  it("pins @oab/shared to the workspace version in every dependent", () => {
    const { version } = json<{ version: string }>("packages/shared/package.json");
    for (const dir of dirs) {
      const pkg = json<{ dependencies?: Record<string, string> }>(`${dir}/package.json`);
      const range = pkg.dependencies?.["@oab/shared"];
      if (range !== undefined) expect(range, dir).toBe(version);
    }
  });
});
