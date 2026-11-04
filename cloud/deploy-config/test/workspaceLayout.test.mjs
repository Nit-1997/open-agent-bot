import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const json = (path) => JSON.parse(read(path));
const DOCKERFILES = ["cloud/agent/Dockerfile", "cloud/web/Dockerfile"];

function workspaces() {
  return json("package.json").workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const base = pattern.slice(0, -2);
    return readdirSync(join(ROOT, base), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, base, e.name, "package.json")))
      .map((e) => `${base}/${e.name}`);
  });
}

function installStage(dockerfile) {
  const text = read(dockerfile);
  const end = text.search(/^RUN npm ci\b/m);
  assert.ok(end > 0, `${dockerfile} has no RUN npm ci`);
  return text.slice(0, end);
}

describe("cloud workspace layout", () => {
  const all = workspaces();
  const cloud = all.filter((ws) => ws.startsWith("cloud/"));

  it("finds the cloud workspaces through the cloud/* entry", () => {
    for (const ws of ["cloud/agent", "cloud/web", "cloud/deploy-config", "cloud/e2e"]) assert.ok(cloud.includes(ws), ws);
    assert.ok(all.includes("packages/core") && all.includes("e2e"));
  });

  it("keeps every deployment artifact and the env files in the one folder cloud/deploy-config", () => {
    const tracked = execFileSync("git", ["ls-files", "--", "cloud/deploy/"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(tracked, "", "git tracks nothing under cloud/deploy (an older checkout's ignored env files may stay there)");
    for (const entry of ["compose.hosted", "compose.preview"]) assert.ok(existsSync(join(ROOT, `cloud/deploy-config/${entry}.yml`)), entry);
    for (const entry of ["caddy", "searxng", "renderer", "litellm", "scripts", "test", "env-files"])
      assert.ok(existsSync(join(ROOT, "cloud/deploy-config", entry)), entry);
    for (const group of ["backend", "frontend", "ops"])
      assert.ok(existsSync(join(ROOT, "cloud/deploy-config/env-files", group, ".env.example")), group);
  });

  it("names every cloud package @oab/cloud-*", () => {
    for (const ws of cloud) assert.match(json(`${ws}/package.json`).name, /^@oab\/cloud-/, ws);
  });

  for (const dockerfile of DOCKERFILES) {
    it(`${dockerfile} copies every workspace package.json, cloud ones included, before npm ci`, () => {
      const stage = installStage(dockerfile);
      for (const ws of all) assert.ok(stage.includes(`COPY ${ws}/package.json ${ws}/`), `${dockerfile} misses COPY ${ws}/package.json`);
    });
  }

  it("cloud/web/tsconfig.json points typebox paths at files that exist", () => {
    const { compilerOptions } = json("cloud/web/tsconfig.json");
    const targets = Object.entries(compilerOptions.paths)
      .filter(([key]) => key.startsWith("typebox"))
      .flatMap(([, values]) => values);
    assert.ok(targets.length > 0);
    for (const target of targets) assert.ok(existsSync(join(ROOT, "cloud/web", target)), target);
  });

  it("pins @oab/shared to the workspace version in every cloud dependent", () => {
    const { version } = json("packages/shared/package.json");
    for (const ws of cloud) {
      const range = json(`${ws}/package.json`).dependencies?.["@oab/shared"];
      if (range !== undefined) assert.equal(range, version, ws);
    }
  });

  it("@oab/cloud-e2e's test script runs its unit tests only, never Playwright or Supabase", () => {
    const { scripts } = json("cloud/e2e/package.json");
    assert.equal(scripts.test, "node --test --disable-warning=ExperimentalWarning support/*.test.ts scripts/auth-probes.test.ts");
    assert.doesNotMatch(scripts.test, /playwright|supabase|smoke/);
  });

  it("the lockfile has an entry for every cloud workspace", () => {
    const lock = json("package-lock.json").packages;
    for (const ws of cloud) assert.ok(lock[ws], `package-lock.json has no "${ws}" entry`);
  });
});
