import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const BIOME = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
const PACKAGES = join(import.meta.dirname, "../../..");
const work = mkdtempSync(join(tmpdir(), "no-cloud-"));
let n = 0;

function lint(pkg: "core" | "shared", file: string, code: string) {
  const root = join(work, String(n++), "packages", pkg);
  mkdirSync(dirname(join(root, file)), { recursive: true });
  const config = { extends: [join(PACKAGES, pkg, "biome.json")], files: { includes: ["src/**/*.ts"] } };
  writeFileSync(join(root, "biome.json"), JSON.stringify(config));
  writeFileSync(join(root, file), code);
  const res = spawnSync(process.execPath, [BIOME, "lint", "--colors=off", file], { cwd: root, encoding: "utf8" });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

afterAll(() => rmSync(work, { recursive: true, force: true }));

const blocked = [
  'import x from "../../../cloud/agent/store.ts";\nexport default x;\n',
  'export const load = () => import("../../cloud/web/x");\n',
  'export * from "../cloud/x";\n',
  'import x from "@oab/cloud";\nexport default x;\n',
  'import x from "@oab/cloud/agent";\nexport default x;\n',
];

const allowed = [
  'import x from "@google-cloud/storage";\nexport default x;\n',
  'import x from "./cloudinary.ts";\nexport default x;\n',
  'import x from "../clouds/x";\nexport default x;\n',
  'export const load = () => import("@google-cloud/storage");\n',
];

describe("no imports from cloud/", () => {
  it.each(blocked)("blocks %s in packages/core", (code) => {
    const r = lint("core", "src/http/fixture.ts", code);
    expect(r.out).toContain("lint/style/noRestrictedImports");
    expect(r.out).toContain("Nothing outside cloud/ may import from cloud/.");
    expect(r.status).not.toBe(0);
  });

  it.each(allowed)("allows %s", (code) => {
    const r = lint("core", "src/http/fixture.ts", code);
    expect(r.out).not.toContain("noRestrictedImports");
    expect(r.status).toBe(0);
  });

  it("blocks cloud imports in packages/shared/src too", () => {
    const r = lint("shared", "src/fixture.ts", 'import x from "../../cloud/agent/store.ts";\nexport default x;\n');
    expect(r.out).toContain("lint/style/noRestrictedImports");
    expect(r.status).not.toBe(0);
  });
});
