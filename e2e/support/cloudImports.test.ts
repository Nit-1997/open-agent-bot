import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const E2E = join(import.meta.dirname, "..");
const BIOME = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
const MESSAGE = "Nothing outside cloud/ may import from cloud/.";

function lint(code: string) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-cloud-imports-"));
  try {
    mkdirSync(join(dir, "support"));
    copyFileSync(join(E2E, "biome.json"), join(dir, "biome.json"));
    writeFileSync(join(dir, "support/injected.ts"), code);
    const out = spawnSync(process.execPath, [BIOME, "lint", "--colors=off", "support/injected.ts"], { cwd: dir, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("e2e lint: no imports from cloud/", () => {
  for (const code of [
    'import { x } from "../../cloud/e2e/support/users.ts";\nexport default x;\n',
    'export const load = () => import("../cloud/web/x.ts");\n',
    'import x from "@oab/cloud";\nexport default x;\n',
    'import x from "@oab/cloud-e2e/support/users.ts";\nexport default x;\n',
  ])
    it(`blocks ${code.split("\n")[0]}`, () => {
      const r = lint(code);
      assert.notEqual(r.status, 0);
      assert.ok(r.output.includes(MESSAGE), r.output);
    });

  for (const code of [
    'import { previewOriginProblem } from "./origin.ts";\nexport default previewOriginProblem;\n',
    'import x from "@google-cloud/storage";\nexport default x;\n',
    'import x from "./cloudy.ts";\nexport default x;\n',
  ])
    it(`allows ${code.split("\n")[0]}`, () => {
      const r = lint(code);
      assert.ok(!r.output.includes(MESSAGE), r.output);
    });
});
