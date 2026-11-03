import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const BIOME = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["next*", /^next([-/].*)?$/],
  ["react*", /^react([-/].*)?$/],
  ["@supabase/*", /^@supabase\//],
  ["@oab/ui*", /^@oab\/ui(\/.*)?$/],
  ["@oab/core*", /^@oab\/core(\/.*)?$/],
  ["@copilotkit/*", /^@copilotkit\//],
  ["node:*", /^node:/],
  ["**/web/**", /(^|\/)web(\/|$)/],
  ["**/cloud/**", /(^|\/)cloud(\/|$)/],
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]([^"'`]+)["'`]/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|mts)$/.test(e.name) ? [path] : [];
  });
}

const violations = (files: readonly string[]) =>
  files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(SPECIFIER)].flatMap(([, spec]) =>
      FORBIDDEN.filter(([, re]) => re.test(spec)).map(([rule]) => `${relative(ROOT, file)}: ${spec} (${rule})`),
    ),
  );

function lint(code: string) {
  const dir = mkdtempSync(join(tmpdir(), "bff-boundary-"));
  try {
    mkdirSync(join(dir, "src"));
    copyFileSync(join(ROOT, "biome.json"), join(dir, "biome.json"));
    writeFileSync(join(dir, "src/injected.ts"), code);
    const out = spawnSync(process.execPath, [BIOME, "lint", "src/injected.ts"], { cwd: dir, encoding: "utf8" });
    return { status: out.status, output: `${out.stdout}${out.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const INJECTED = [
  'import { NextResponse } from "next/server";\nexport default NextResponse;\n',
  'import { useState } from "react";\nexport default useState;\n',
  'import "@supabase/ssr";\n',
  'import { api } from "@oab/ui/platform/api.js";\nexport default api;\n',
  'import { Buffer } from "node:buffer";\nexport default Buffer;\n',
  'import { app } from "@oab/core/http/app.js";\nexport default app;\n',
  'import { CopilotRuntime } from "@copilotkit/runtime/v2";\nexport default CopilotRuntime;\n',
  'import { requireUser } from "../../../web/lib/auth";\nexport default requireUser;\n',
  'export const load = () => import("next/headers");\n',
];

const ALLOWED = [
  'import { normalizeId } from "@oab/shared/ids";\nexport default normalizeId;\n',
  'import { jsonError } from "./forward.ts";\nexport default jsonError;\n',
  'import x from "../webview/x.ts";\nexport default x;\n',
];

describe("packages/bff boundary", { timeout: 60000 }, () => {
  it("has no forbidden import in src", () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it("the scan catches every forbidden shape", () => {
    for (const spec of [
      "next",
      "next/server",
      "react",
      "react-dom/client",
      "@supabase/ssr",
      "@oab/ui/platform/api.js",
      "@oab/core/http/app.js",
      "@copilotkit/runtime/v2",
      "node:buffer",
      "../../web/lib/auth",
      "../cloud/x",
    ])
      expect(
        FORBIDDEN.some(([, re]) => re.test(spec)),
        spec,
      ).toBe(true);
    for (const spec of ["@oab/shared/ids", "./forward.ts", "../webview/x.ts", "nextStep"])
      expect(
        FORBIDDEN.some(([, re]) => re.test(spec)),
        spec,
      ).toBe(false);
  });

  it.each(INJECTED)("lint blocks %s", (code) => {
    const { status, output } = lint(code);
    expect(status).not.toBe(0);
    expect(output).toContain("packages/bff must stay framework-free");
  });

  it.each(ALLOWED)("lint allows %s", (code) => {
    const { status, output } = lint(code);
    expect(output).not.toContain("packages/bff must stay framework-free");
    expect(status).toBe(0);
  });
});
