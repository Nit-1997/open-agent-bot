import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = readFileSync(join(ROOT, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}

function ignored(path) {
  let out = false;
  for (const rule of RULES) {
    const negate = rule.startsWith("!");
    const pattern = (negate ? rule.slice(1) : rule).replace(/^\/+/, "").replace(/\/+$/, "");
    if (globToRegExp(pattern).test(path)) out = !negate;
  }
  return out;
}

describe(".dockerignore", () => {
  for (const name of [".env", ".env-agent", "deploy-config/.env-agent", "deploy-config/.env-renderer", "packages/core/.env", "web/.env.local"]) {
    it(`excludes ${name}`, () => assert.equal(ignored(name), true));
  }

  for (const name of ["deploy-config/env-files/.env-e2e", "deploy-config/env-files/.env-supabase-admin", "deploy-config/env-files/anything"]) {
    it(`excludes ${name}`, () => assert.equal(ignored(name), true));
  }

  for (const name of ["server.pem", "deploy-config/certs/tls.pem", "tls.key", ".factory", ".factory/m3/logs/x.txt", ".git", "node_modules"]) {
    it(`excludes ${name}`, () => assert.equal(ignored(name), true));
  }

  for (const rule of [".factory", "**/.env*", "**/*.pem", "deploy-config/.env*", "deploy-config/env-files"]) {
    it(`lists ${rule}`, () => assert.ok(RULES.includes(rule) || RULES.includes(`${rule}/`), rule));
  }

  for (const name of ["apps/desktop/release/Open-Agent-0.0.0-dev-arm64.dmg", "apps/desktop/release/mac-arm64/Open Agent.app/Contents/Info.plist", "apps/desktop/build/stack/docker-compose.yml"]) {
    it(`excludes ${name}`, () => assert.equal(ignored(name), true));
  }

  for (const name of ["apps/desktop/package.json", "packages/core/src/local/main.ts", "packages/local-web/index.html", "deploy-config/env.examples/agent.env.example", "package-lock.json"]) {
    it(`keeps ${name}`, () => assert.equal(ignored(name), false));
  }
});
