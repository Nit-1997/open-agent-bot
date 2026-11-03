import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
const MESSAGE = "packages/local-web must stay local-only";

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["next*", /^next/],
  ["@supabase/*", /^@supabase\//],
  ["@oab/core*", /^@oab\/core(\/.*)?$/],
  ["@oab/bff*", /^@oab\/bff(\/.*)?$/],
  ["**/web/**", /(^|\/)web(\/|$)/],
  ["**/cloud/**", /(^|\/)cloud(\/|$)/],
  ["node:*", /^node:/],
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+)["'`]([^"'`]+)["'`]/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts|css)$/.test(e.name) ? [path] : [];
  });
}

function violations(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(SPECIFIER)].flatMap(([, spec]) =>
      FORBIDDEN.filter(([, re]) => re.test(spec)).map(([rule]) => `${relative(ROOT, file)}: ${spec} (${rule})`),
    ),
  );
}

const isForbidden = (spec: string) => FORBIDDEN.some(([, re]) => re.test(spec));

const eslint = new ESLint({ cwd: ROOT });
const RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function restricted(code: string, filePath = "src/LocalApp.tsx") {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId !== null && RULES.has(m.ruleId));
}

const FORBIDDEN_SPECS = [
  "next",
  "next/link",
  "next-themes",
  "@supabase/supabase-js",
  "@supabase/ssr",
  "@oab/core",
  "@oab/core/local/hosts.js",
  "@oab/bff",
  "@oab/bff/index.js",
  "../../../web/lib/auth",
  "../../cloud/x",
  "node:fs",
];

const ALLOWED_SPECS = [
  "react",
  "react-dom/client",
  "@oab/ui/platform",
  "@oab/ui/components/shell/AppShell.tsx",
  "@oab/shared/routes",
  "./theme.ts",
  "../webview/x.ts",
];

describe("packages/local-web boundary (B10)", { timeout: 30000 }, () => {
  it("has no forbidden import in src", () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it("the scan catches every forbidden shape and nothing else", () => {
    for (const spec of FORBIDDEN_SPECS) expect(isForbidden(spec), spec).toBe(true);
    for (const spec of ALLOWED_SPECS) expect(isForbidden(spec), spec).toBe(false);
  });

  it.each(FORBIDDEN_SPECS)("lint blocks a static import of %s with exactly one error", async (spec) => {
    const messages = await restricted(`import "${spec}";\n`);
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain(MESSAGE);
  });

  it.each(FORBIDDEN_SPECS)("lint blocks a dynamic import of %s", async (spec) => {
    const messages = await restricted(`export const load = () => import("${spec}");\n`);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain(MESSAGE);
  });

  it.each(ALLOWED_SPECS)("lint allows %s", async (spec) => {
    expect(await restricted(`import "${spec}";\n`)).toEqual([]);
  });

  it("lint applies the boundary to every file under src", async () => {
    expect(await restricted('import "@supabase/supabase-js";\n', "src/deep/nested/file.ts")).toHaveLength(1);
  });
});
