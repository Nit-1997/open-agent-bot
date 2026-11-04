import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("every line is an absolute path owned by @Nit-1997", () => {
    for (const l of lines) assert.match(l, /^\/\S+ @Nit-1997$/, l);
  });
});
