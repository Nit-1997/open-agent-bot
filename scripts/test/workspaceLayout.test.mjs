import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const DOCKERFILES = ["web/Dockerfile", "packages/core/Dockerfile"];
const CHECKED_PACKAGES = ["packages/ui", "packages/bff"];
const BUNDLED_APPS = ["packages/local-web"];

function workspaces() {
  return json("package.json").workspaces.flatMap((pattern) => {
    if (!pattern.endsWith("/*")) return [pattern];
    const base = pattern.slice(0, -2);
    return readdirSync(join(ROOT, base), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, base, e.name, "package.json")))
      .map((e) => `${base}/${e.name}`);
  });
}

function installStage(dockerfile) {
  const text = readFileSync(join(ROOT, dockerfile), "utf8");
  const end = text.search(/^RUN npm ci\b/m);
  assert.ok(end > 0, `${dockerfile} has no RUN npm ci`);
  return text.slice(0, end);
}

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx|mts|js|mjs|css)$/.test(e.name) ? [path] : [];
  });
}

const SPECIFIERS = [
  /^\s*(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s*from\s*["']([^"']+)["']/gm,
  /^\s*import\s*["']([^"']+)["']/gm,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /^\s*@import\s+["']([^"']+)["']/gm,
];

const specifiersOf = (text) => SPECIFIERS.flatMap((re) => [...text.matchAll(re)].map(([, spec]) => spec));
const packageName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

function bareImports(dir) {
  return new Set(
    sources(dir).flatMap((file) =>
      specifiersOf(readFileSync(file, "utf8"))
        .filter((spec) => !spec.startsWith(".") && !spec.startsWith("node:"))
        .map(packageName),
    ),
  );
}

describe("workspace layout", () => {
  const all = workspaces();

  it("finds the workspaces", () => {
    assert.ok(all.includes("packages/ui"), "packages/ui is a workspace");
    assert.ok(all.includes("web"));
  });

  for (const dockerfile of DOCKERFILES) {
    it(`${dockerfile} copies every workspace package.json before npm ci`, () => {
      const stage = installStage(dockerfile);
      for (const ws of all) assert.ok(stage.includes(`COPY ${ws}/package.json ${ws}/`), `${dockerfile} misses COPY ${ws}/package.json`);
    });
  }

  for (const ws of CHECKED_PACKAGES.filter((p) => existsSync(join(ROOT, p, "package.json")))) {
    it(`${ws} declares every bare import of its src`, () => {
      const pkg = json(`${ws}/package.json`);
      const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
      const missing = [...bareImports(join(ROOT, ws, "src"))].filter((name) => !declared.has(name));
      assert.deepEqual(missing, []);
    });
  }

  it("finds the local-web workspace", () => {
    assert.ok(all.includes("packages/local-web"));
  });

  for (const ws of BUNDLED_APPS) {
    it(`${ws} declares every bare import of its src, build-time packages included`, () => {
      const pkg = json(`${ws}/package.json`);
      const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]);
      const missing = [...bareImports(join(ROOT, ws, "src"))].filter((name) => !declared.has(name));
      assert.deepEqual(missing, []);
    });
  }

  it("reads import, export, dynamic and CSS @import specifiers, and nothing from JSX text", () => {
    const text = [
      'import { a } from "pkg-a";',
      'export { b } from "pkg-b";',
      'import "pkg-side";',
      'const c = () => import("pkg-dynamic");',
      '@import "@scope/pkg-css/file.css";',
      '<p label="Flying from" title={x ? "y" : "z"} />',
    ].join("\n");
    assert.deepEqual(specifiersOf(text).sort(), ["@scope/pkg-css/file.css", "pkg-a", "pkg-b", "pkg-dynamic", "pkg-side"]);
    const ui = bareImports(join(ROOT, "packages/ui/src"));
    for (const name of ["@fontsource/dm-mono", "@fontsource/instrument-serif", "@fontsource-variable/dm-sans"]) assert.ok(ui.has(name), name);
  });

  it("the lockfile has an entry for every workspace", () => {
    const lock = json("package-lock.json").packages;
    for (const ws of all) assert.ok(lock[ws], `package-lock.json has no "${ws}" entry`);
  });
});
