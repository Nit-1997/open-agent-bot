import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("hosted env split", () => {
  const importsHostedEnv = (path: string) => /from\s+["']\.\.?\/(support\/)?env(\.ts)?["']/.test(readFileSync(join(E2E, path), "utf8"));

  it("the hosted support files take ROOT, AUTH_DIR and scriptEnv from support/env.ts", () => {
    for (const path of ["global-setup.ts", "support/admin.ts", "support/state.ts", "support/users.ts"])
      assert.ok(importsHostedEnv(path), path);
  });
});
