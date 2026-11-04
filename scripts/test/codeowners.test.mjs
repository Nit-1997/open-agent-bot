import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const lines = readFileSync(join(ROOT, ".github/CODEOWNERS"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe("CODEOWNERS (M6 D14)", () => {
  it("names the owner for the cloud deploy files, the cloud Dockerfiles, the hosted e2e support, the boundary tooling and the ignore files", () => {
    for (const path of [
      "/cloud/deploy/",
      "/cloud/agent/Dockerfile",
      "/cloud/web/Dockerfile",
      "/cloud/e2e/support/",
      "/scripts/ci/",
      "/scripts/boundary/",
      "/scripts/move/",
      "/.gitignore",
      "/.dockerignore",
    ])
      assert.ok(lines.includes(`${path} @Nit-1997`), path);
  });

  it("names the owner for the auth, build and install inputs (M6 fix S2)", () => {
    for (const path of [
      "/cloud/supabase/",
      "/cloud/agent/src/identity/",
      "/cloud/web/proxy.ts",
      "/cloud/web/next.config.ts",
      "/scripts/postinstall.mjs",
      "/patches/",
      "/package.json",
      "/package-lock.json",
      "/packages/core/Dockerfile",
      "/docker-compose.yml",
      "/scripts/preview-preflight.sh",
    ])
      assert.ok(lines.includes(`${path} @Nit-1997`), path);
  });

  it("every path it names exists", () => {
    for (const l of lines) assert.ok(existsSync(join(ROOT, l.split(" ")[0].slice(1))), l);
  });

  it("every line is an absolute path owned by @Nit-1997", () => {
    for (const l of lines) assert.match(l, /^\/\S+ @Nit-1997$/, l);
  });
});
