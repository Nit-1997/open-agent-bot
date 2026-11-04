import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers } from "../lint/boundary.js";

const PACKAGES = resolve(import.meta.dirname, "../../..");
const CORE_SRC = join(PACKAGES, "core/src");
const ENTRY = join(CORE_SRC, "local/main.ts");

type Graph = { files: string[]; bare: string[] };
type Reader = (file: string) => string | undefined;

const readDisk: Reader = (file) => (existsSync(file) ? readFileSync(file, "utf8") : undefined);

function workspaceFile(specifier: string): string | undefined {
  if (specifier.startsWith("@oab/core/")) return join(CORE_SRC, specifier.slice("@oab/core/".length));
  if (specifier.startsWith("@oab/shared/")) return join(PACKAGES, "shared/src", specifier.slice("@oab/shared/".length));
  if (specifier === "@oab/bff") return join(PACKAGES, "bff/src/index.ts");
  return undefined;
}

function sourceOf(path: string, read: Reader): string | undefined {
  const candidates = [path.replace(/\.js$/, ".ts"), path, `${path}.ts`];
  return candidates.find((c) => c.endsWith(".ts") && read(c) !== undefined);
}

function walkImports(entry: string, read: Reader = readDisk): Graph {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = read(file);
    if (code === undefined) throw new Error(`cannot read ${file}`);
    for (const specifier of importSpecifiers(code)) {
      const target = specifier.startsWith(".") ? resolve(dirname(file), specifier) : workspaceFile(specifier);
      if (!target) {
        bare.add(specifier);
        continue;
      }
      const source = sourceOf(target, read);
      if (!source) throw new Error(`${relative(PACKAGES, file)} imports ${specifier}, which does not resolve`);
      queue.push(source);
    }
  }
  return { files: [...seen].map((f) => relative(PACKAGES, f)).sort(), bare: [...bare].sort() };
}

const forbidden = (g: Graph) => [
  ...g.files.filter((f) => f.startsWith("core/src/hosted/")),
  ...g.bare.filter((s) => s.startsWith("@supabase/") || s === "jose" || s.startsWith("jose/")),
];

describe("the local entry's import graph", () => {
  const graph = walkImports(ENTRY);

  it("walks the real entry, core's startAgent and the bff", () => {
    expect(graph.files).toEqual(
      expect.arrayContaining([
        "core/src/local/main.ts",
        "core/src/local/start.ts",
        "core/src/startAgent.ts",
        "core/src/local/store/sqliteStore.ts",
        "bff/src/index.ts",
      ]),
    );
    expect(graph.files.length).toBeGreaterThan(100);
  });

  it("reaches no hosted file, no @supabase/* and no jose", () => {
    expect(forbidden(graph)).toEqual([]);
  });

  it.each([
    ["a static hosted import", 'import "../hosted/deps.js";\n', "core/src/hosted/deps.ts"],
    ["a dynamic hosted import", 'await import("@oab/core/hosted/config.js");\n', "core/src/hosted/config.ts"],
    ["@supabase/supabase-js", 'import "@supabase/supabase-js";\n', "@supabase/supabase-js"],
    ["jose", 'export const j = () => import("jose");\n', "jose"],
  ])("catches %s injected into start.ts", (_label, line, hit) => {
    const start = join(CORE_SRC, "local/start.ts");
    const hosted = join(CORE_SRC, "hosted/");
    const injected: Reader = (file) => {
      if (file.startsWith(hosted)) return "export {};\n";
      const code = readDisk(file);
      return file === start && code !== undefined ? `${code}${line}` : code;
    };
    expect(forbidden(walkImports(ENTRY, injected))).toContain(hit);
  });
});
