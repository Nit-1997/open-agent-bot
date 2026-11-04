import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "e95883b7eccdd6cf661d4ac842ec34b4ff634157";
const ADDED = { "@biomejs/biome": "2.6.3", marked: "12.0.2", yaml: "2.9.0" };
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });

const scriptFiles = () =>
  git("ls-files", "-co", "--exclude-standard", "--", "scripts")
    .split("\n")
    .filter((f) => f.endsWith(".mjs"));

const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

function bareImports(text) {
  return ts
    .preProcessFile(text, true, true)
    .importedFiles.map((f) => f.fileName)
    .filter((spec) => !spec.startsWith(".") && !spec.startsWith("/"));
}

function lockfileAfter() {
  const commits = git("rev-list", "--topo-order", "--reverse", `${BASE}..HEAD`, "--", "package-lock.json").split("\n").filter(Boolean);
  return JSON.parse(
    commits.length ? git("show", `${commits[0]}:package-lock.json`) : readFileSync(join(ROOT, "package-lock.json"), "utf8"),
  );
}

describe("root dependencies of scripts/", () => {
  it("reads static, dynamic and side-effect imports, not strings", () => {
    const text = [
      'import a from "pkg-a";',
      'import "pkg-side";',
      'const b = await import("@s/pkg-b/x");',
      "const s = 'import c from \"pkg-c\"';",
    ].join("\n");
    assert.deepEqual(bareImports(text).map(packageOf), ["pkg-a", "pkg-side", "@s/pkg-b"]);
  });

  it("every bare import in scripts/**/*.mjs is node: or a root dependency", () => {
    const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
    const files = scriptFiles();
    assert.ok(files.length > 20, `${files.length} script files`);
    const missing = files.flatMap((file) =>
      bareImports(readFileSync(join(ROOT, file), "utf8"))
        .filter((spec) => !spec.startsWith("node:") && !declared.has(packageOf(spec)))
        .map((spec) => `${file}: ${spec}`),
    );
    assert.deepEqual(missing, []);
  });

  it("pins the added root devDependencies exactly", () => {
    for (const [name, version] of Object.entries(ADDED)) assert.equal(pkg.devDependencies?.[name], version, name);
  });
});

describe("scripts lint wiring", () => {
  it("root lint and format:check run the scripts checks", () => {
    assert.equal(pkg.scripts["lint:scripts"], "biome check --config-path scripts/biome.json scripts");
    assert.equal(pkg.scripts["format:check:scripts"], "biome format --config-path scripts/biome.json scripts");
    assert.match(pkg.scripts.lint, /&& npm run lint:scripts && npm run lint:boundary$/);
    assert.match(pkg.scripts["format:check"], /&& npm run format:check:scripts$/);
  });

  it("scripts/biome.json covers every .mjs and never turns noTemplateCurlyInString off", () => {
    const text = readFileSync(join(ROOT, "scripts/biome.json"), "utf8");
    const config = JSON.parse(text);
    assert.deepEqual(config.files.includes, ["**/*.mjs"]);
    assert.equal(config.linter.rules.preset, "recommended");
    assert.doesNotMatch(text, /noTemplateCurlyInString/);
  });
});

describe("package-lock.json diff for the root devDependencies", () => {
  const before = JSON.parse(git("show", `${BASE}:package-lock.json`));
  const after = lockfileAfter();

  it("adds only the new edges under the root package entry", () => {
    const { devDependencies: beforeDev, ...beforeRest } = before.packages[""];
    const { devDependencies: afterDev, ...afterRest } = after.packages[""];
    assert.deepEqual(afterRest, beforeRest);
    assert.deepEqual(afterDev, { ...beforeDev, ...ADDED });
  });

  it("adds, removes and changes no other lockfile entry", () => {
    const keys = (lock) => Object.keys(lock.packages).sort();
    assert.deepEqual(keys(after), keys(before));
    const changed = keys(before).filter((k) => k !== "" && JSON.stringify(before.packages[k]) !== JSON.stringify(after.packages[k]));
    assert.deepEqual(changed, []);
    const { packages: _a, ...afterTop } = after;
    const { packages: _b, ...beforeTop } = before;
    assert.deepEqual(afterTop, beforeTop);
  });

  it("each added edge resolves to an existing root-level entry", () => {
    for (const [name, version] of Object.entries(ADDED)) assert.equal(after.packages[`node_modules/${name}`]?.version, version, name);
  });
});
