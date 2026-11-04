import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ENV_EXAMPLES, NEW_RULES, SECRET_PATHS } from "./secretPaths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = readFileSync(join(ROOT, ".gitignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const LEGACY_RULES = [
  ".env",
  ".env.*",
  "deploy-config/.env*",
  "deploy-config/**/.env*",
  "e2e/test-results/",
  "e2e/playwright-report/",
  "e2e/.auth/",
  "e2e/.local/",
  ".factory/",
  "*.pem",
  "*.key",
];

const checkIgnore = (path) => spawnSync("git", ["check-ignore", "-q", "--no-index", path], { cwd: ROOT }).status;

describe(".gitignore", () => {
  for (const name of SECRET_PATHS) {
    it(`ignores ${name}`, () => assert.equal(checkIgnore(name), 0));
  }

  for (const rule of [
    ...NEW_RULES,
    "!cloud/deploy-config/env-files/*/",
    "!cloud/deploy-config/env-files/*/.env.example",
    "cloud/deploy/.env*",
    ...LEGACY_RULES,
  ]) {
    it(`lists ${rule}`, () => assert.ok(RULES.includes(rule), rule));
  }

  for (const name of [
    ".env.example",
    "deploy-config/env.examples/agent.env.example",
    ...ENV_EXAMPLES,
    "cloud/deploy/compose.hosted.yml",
    "cloud/e2e/support/env.ts",
    "e2e/support/env.ts",
    "package-lock.json",
  ]) {
    it(`keeps ${name}`, () => assert.equal(checkIgnore(name), 1));
  }

  it("ignores the local e2e marker files", () => {
    assert.equal(checkIgnore("e2e/.local/app-18740.json"), 0);
  });

  it("ignores the planning specs, which stay out of the public repo", () => {
    assert.equal(checkIgnore("docs/superpowers/specs/x-design.md"), 0);
    assert.equal(checkIgnore("docs/superpowers/plans/x.md"), 0);
    assert.equal(checkIgnore("docs/INSTALL.md"), 1);
    const tracked = execFileSync("git", ["ls-files", "docs/superpowers"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(tracked, "");
  });

  it("ignores local Claude Code folders at any depth", () => {
    assert.equal(checkIgnore(".claude/settings.local.json"), 0);
    assert.equal(checkIgnore("cloud/web/.claude/settings.json"), 0);
    const tracked = execFileSync("git", ["ls-files", "**/.claude/**"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(tracked, "");
  });

  it("ignores no tracked file", () => {
    const tracked = execFileSync("git", ["ls-files", "-ci", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(tracked, "");
  });
});
