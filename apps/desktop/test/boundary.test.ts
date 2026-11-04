import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { boundaryViolations, importSpecifiers } from "./support/boundary.ts";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");

const files = (dir: string, ext: RegExp): string[] =>
  (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" || e.name === ".next" ? [] : files(p, ext);
    return ext.test(e.name) ? [p] : [];
  });

describe("B11 import boundary", () => {
  it("reads static, dynamic, require and side-effect imports", () => {
    const text = [
      'import { a } from "electron";',
      'import type { B } from "./b.ts";',
      'export * from "../c.ts";',
      'import "node:fs";',
      'const d = await import("@oab/core");',
      'const e = require("lodash");',
    ].join("\n");
    expect(importSpecifiers(text).sort()).toEqual(["../c.ts", "./b.ts", "@oab/core", "electron", "lodash", "node:fs"]);
  });

  it("flags anything other than electron, node:* and files inside src", () => {
    const src = join(APP, "src");
    const file = join(src, "main/x.ts");
    const text = [
      'import "@oab/core";',
      'import "@oab/shared/local";',
      'import "react";',
      'import "../../../../packages/core/src/x.ts";',
      'import "../../../../web/lib/x.ts";',
      'import "../../test/fake-docker/fake-agent.mjs";',
      'import "electron";',
      'import "node:path";',
      'import "./ok.ts";',
      'import "../shared/actions.ts";',
    ].join("\n");
    expect(boundaryViolations(file, text, src).map((v) => v.spec)).toEqual([
      "@oab/core",
      "@oab/shared/local",
      "react",
      "../../../../packages/core/src/x.ts",
      "../../../../web/lib/x.ts",
      "../../test/fake-docker/fake-agent.mjs",
    ]);
  });

  it("holds for every file in apps/desktop/src", () => {
    const src = join(APP, "src");
    const all = files(src, /\.(ts|mts|cts|js|mjs|cjs)$/);
    expect(all.length).toBeGreaterThan(10);
    const bad = all.flatMap((f) => boundaryViolations(f, readFileSync(f, "utf8"), src).map((v) => `${relative(APP, f)}: ${v.spec}`));
    expect(bad).toEqual([]);
  });

  it("nothing in packages/ or web/ imports the desktop app", () => {
    const roots = [join(REPO, "packages"), join(REPO, "web")];
    const hits = roots
      .flatMap((r) => files(r, /\.(ts|tsx|mts|js|mjs)$/))
      .filter((f) =>
        importSpecifiers(readFileSync(f, "utf8")).some((s) => s.startsWith("@oab/desktop") || /(^|\/)apps\/desktop(\/|$)/.test(s)),
      );
    expect(hits.map((f) => relative(REPO, f))).toEqual([]);
  });

  it("the folder walk skips a missing root (web/ leaves in M6)", () => {
    expect(files(join(REPO, "no-such-root"), /\.ts$/)).toEqual([]);
  });

  it("the Biome rule rejects an injected @oab/cloud-web import in src", () => {
    const probe = join(APP, "src/main/boundary-cloud-probe.ts");
    writeFileSync(probe, 'import "@oab/cloud-web";\nexport const probe = 1;\n');
    try {
      const run = spawnSync(join(REPO, "node_modules/.bin/biome"), ["lint", relative(APP, probe)], { cwd: APP, encoding: "utf8" });
      expect(run.status).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain("B11");
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it("the Biome rule rejects an injected @oab/core import in src", () => {
    const probe = join(APP, "src/main/boundary-probe.ts");
    writeFileSync(probe, 'import "@oab/core";\nexport const probe = 1;\n');
    try {
      const run = spawnSync(join(REPO, "node_modules/.bin/biome"), ["lint", relative(APP, probe)], { cwd: APP, encoding: "utf8" });
      expect(run.status).not.toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain("B11");
    } finally {
      rmSync(probe, { force: true });
    }
  });
});
