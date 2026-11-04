import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CORE = join(import.meta.dirname, "../..");
const TSC = join(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");

const nodeImport = (specifier: string) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(specifier)});`], {
    cwd: CORE,
    encoding: "utf8",
  });

describe("@oab/core self-reference", () => {
  let work = "";

  beforeAll(() => {
    work = mkdtempSync(join(CORE, "test", ".selfref-"));
    const build = spawnSync(process.execPath, [TSC, "-b"], { cwd: CORE, encoding: "utf8" });
    expect(build.status, `${build.stdout}${build.stderr}`).toBe(0);
  }, 180_000);

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("B5: @oab/core/x.js and src/x.ts are the same module instance in Vitest", async () => {
    const viaSelf = await import("@oab/core/lib/errors.js");
    const viaPath = await import("../../src/lib/errors.ts");
    expect(viaSelf).toBe(viaPath);
  });

  it("tsconfig.evals.json maps @oab/core/* to src and keeps the typebox paths", () => {
    const evals = JSON.parse(readFileSync(join(CORE, "tsconfig.evals.json"), "utf8"));
    expect(evals.compilerOptions.paths).toEqual({
      "@oab/core/*": ["./src/*"],
      typebox: ["../../node_modules/typebox/build/index.d.mts"],
      "typebox/value": ["../../node_modules/typebox/build/value/index.d.mts"],
    });
  });

  it("exports everything in dist except local/* and scripts/*", () => {
    const pkg = JSON.parse(readFileSync(join(CORE, "package.json"), "utf8"));
    expect(pkg.exports).toEqual({ "./*": "./dist/*", "./local/*": null, "./scripts/*": null });
  });

  it.each(["@oab/core/hosted/config.js", "@oab/core/hosted/store/client.js"])(
    "R2: node finds no %s (core has no hosted modules)",
    (specifier) => {
      const r = nodeImport(specifier);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("ERR_MODULE_NOT_FOUND");
    },
  );

  it.each(["@oab/core/scripts/rotateCredentials.js", "@oab/core/local/start.js", "@oab/core/local/store/sqliteStore.js"])(
    "R2: node refuses %s with ERR_PACKAGE_PATH_NOT_EXPORTED",
    (specifier) => {
      const r = nodeImport(specifier);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("ERR_PACKAGE_PATH_NOT_EXPORTED");
    },
  );

  it("R2: node resolves @oab/core/lib/errors.js from the build", () => {
    const r = nodeImport("@oab/core/lib/errors.js");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("R2: tsc reports TS2307 for hosted/* and scripts/* but resolves lib/*", () => {
    const probe = [
      'import { UserError } from "@oab/core/lib/errors.js";',
      'import { a } from "@oab/core/hosted/config.js";',
      'import { b } from "@oab/core/hosted/store/client.js";',
      'import { c } from "@oab/core/scripts/rotateCredentials.js";',
      "export { UserError, a, b, c };",
      "",
    ].join("\n");
    writeFileSync(join(work, "probe.ts"), probe);
    const tsconfig = {
      extends: "../../tsconfig.json",
      compilerOptions: { noEmit: true, rootDir: "../.." },
      include: ["probe.ts"],
      references: [],
    };
    writeFileSync(join(work, "tsconfig.json"), JSON.stringify(tsconfig));
    const r = spawnSync(process.execPath, [TSC, "-p", join(work, "tsconfig.json")], { cwd: CORE, encoding: "utf8" });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).not.toBe(0);
    expect(out).toMatch(/probe\.ts\(2,\d+\): error TS2307: Cannot find module '@oab\/core\/hosted\/config\.js'/);
    expect(out).toMatch(/probe\.ts\(3,\d+\): error TS2307: Cannot find module '@oab\/core\/hosted\/store\/client\.js'/);
    expect(out).toMatch(/probe\.ts\(4,\d+\): error TS2307: Cannot find module '@oab\/core\/scripts\/rotateCredentials\.js'/);
    expect(out).not.toMatch(/probe\.ts\(1,\d+\): error TS2307/);
  });
});
