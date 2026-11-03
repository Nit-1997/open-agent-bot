import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ["next", /^next(\/.*)?$/],
  ["@supabase/*", /^@supabase\//],
  ["@oab/bff*", /^@oab\/bff(\/.*)?$/],
  ["@oab/core*", /^@oab\/core(\/.*)?$/],
  ["@copilotkit/runtime*", /^@copilotkit\/runtime(\/.*)?$/],
  ["hono*", /^hono(\/.*)?$/],
  ["node:*", /^node:/],
  ["**/web/**", /(^|\/)web(\/|$)/],
  ["**/cloud/**", /(^|\/)cloud(\/|$)/],
  ["@/", /^@\//],
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]([^"'`]+)["'`]/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts)$/.test(e.name) ? [path] : [];
  });
}

function violations(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(SPECIFIER)].flatMap(([, spec]) =>
      FORBIDDEN.filter(([, re]) => re.test(spec)).map(([rule]) => `${relative(ROOT, file)}: ${spec} (${rule})`),
    ),
  );
}

const eslint = new ESLint({ cwd: ROOT });
const RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function restricted(code: string) {
  const [result] = await eslint.lintText(code, { filePath: "src/platform/injected.ts" });
  return result.messages.filter((m) => m.ruleId !== null && RULES.has(m.ruleId));
}

const INJECTED = [
  'import Link from "next/link";\nexport default Link;\n',
  'import { useRouter } from "next/navigation";\nexport default useRouter;\n',
  'import "@supabase/ssr";\n',
  'import { createBff } from "@oab/bff/index.js";\nexport default createBff;\n',
  'import { requireUser } from "../../../web/lib/auth";\nexport default requireUser;\n',
  'import x from "@/lib/x";\nexport default x;\n',
  'import { readFileSync } from "node:fs";\nexport default readFileSync;\n',
];

const ALLOWED = [
  'import { useState } from "react";\nexport default useState;\n',
  'import { hrefFor } from "@oab/shared/routes.ts";\nexport default hrefFor;\n',
  'import { useAgent } from "@copilotkit/react-core/v2";\nexport default useAgent;\n',
  'import x from "./nextStep.ts";\nexport default x;\n',
  'import x from "../webview/x.ts";\nexport default x;\n',
];

describe("packages/ui boundary", { timeout: 30000 }, () => {
  it("has no forbidden import in src", () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(0);
    expect(violations(files)).toEqual([]);
  });

  it("the scan catches every forbidden shape", () => {
    const specs = [
      "next",
      "next/link",
      "@supabase/ssr",
      "@oab/bff/index.js",
      "@oab/core/http/app.ts",
      "@copilotkit/runtime/v2",
      "hono/cors",
      "node:fs",
      "../../../web/lib/auth",
      "../../cloud/x",
      "@/lib/x",
    ];
    for (const spec of specs)
      expect(
        FORBIDDEN.some(([, re]) => re.test(spec)),
        spec,
      ).toBe(true);
    for (const spec of ["react", "@oab/shared/routes.ts", "@copilotkit/react-core/v2", "./nextStep.ts", "../webview/x.ts", "lucide-react"])
      expect(
        FORBIDDEN.some(([, re]) => re.test(spec)),
        spec,
      ).toBe(false);
  });

  it.each(INJECTED)("lint blocks %s with exactly one error", async (code) => {
    const messages = await restricted(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain("packages/ui must stay platform-neutral");
  });

  it.each(ALLOWED)("lint allows %s", async (code) => {
    expect(await restricted(code)).toEqual([]);
  });

  it("lint blocks a dynamic import of a forbidden module", async () => {
    const messages = await restricted('export const load = () => import("next/navigation");\n');
    expect(messages).toHaveLength(1);
  });
});
