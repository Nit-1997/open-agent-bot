import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkRepo } from "../boundary/cloud-boundary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECKER = join(ROOT, "scripts/boundary/cloud-boundary.mjs");
const WORK = mkdtempSync(join(tmpdir(), "cloud-boundary-"));
after(() => rmSync(WORK, { recursive: true, force: true }));

let n = 0;
function repo(files, { links = {}, allow = [] } = {}) {
  const root = join(WORK, String(n++));
  mkdirSync(root, { recursive: true });
  const all = { "cloud/agent/package.json": '{"name":"@oab/cloud-agent"}\n', "cloud/agent/src/a.ts": "export const a = 1;\n", ...files };
  if (allow.length) all["scripts/boundary/allow.json"] = JSON.stringify(allow);
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const [path, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    symlinkSync(typeof target === "function" ? target(root) : target, join(root, path));
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

const violations = (files, opts) => checkRepo(repo(files, opts)).violations;
const rules = (vs) => vs.map((v) => `${v.file}:${v.line} ${v.rule}`);

const FAILING = [
  [
    "static import",
    { "packages/x/src/a.ts": 'import { a } from "../../../cloud/agent/src/a.ts";\nexport { a };\n' },
    "packages/x/src/a.ts:1 A",
  ],
  ["import type", { "packages/x/src/a.ts": '\nimport type { A } from "../../../cloud/agent/src/a.ts";\n' }, "packages/x/src/a.ts:2 A"],
  ["side-effect import", { "packages/x/src/a.ts": 'import "../../../cloud/agent/src/a.ts";\n' }, "packages/x/src/a.ts:1 A"],
  ["export * from", { "packages/x/src/a.ts": 'export * from "../../../cloud/agent/src/a.ts";\n' }, "packages/x/src/a.ts:1 A"],
  [
    "dynamic import()",
    { "packages/x/src/a.ts": 'export const f = () => import("../../../cloud/agent/src/a.ts");\n' },
    "packages/x/src/a.ts:1 A",
  ],
  ["require()", { "packages/x/src/a.cjs": 'module.exports = require("../../../cloud/agent/src/a.ts");\n' }, "packages/x/src/a.cjs:1 A"],
  ["CSS @import", { "packages/x/src/a.css": '@import "../../../cloud/web/app/globals.css";\n' }, "packages/x/src/a.css:1 A"],
  [
    "CSS @source",
    { "packages/x/src/a.css": '@import "tailwindcss";\n@source "../../../cloud/web/components";\n' },
    "packages/x/src/a.css:2 A",
  ],
  [
    "tsconfig paths",
    { "packages/x/tsconfig.json": '{\n  "compilerOptions": { "paths": { "@c/*": ["../../cloud/agent/src/*"] } }\n}\n' },
    "B",
  ],
  ["tsconfig references", { "packages/x/tsconfig.json": '{ "references": [{ "path": "../../cloud/agent" }] }\n' }, "B"],
  ["tsconfig extends", { "packages/x/tsconfig.json": '// base\n{ "extends": "../../cloud/agent/tsconfig.json" }\n' }, "B"],
  [
    "vitest alias string",
    { "packages/x/vitest.config.ts": 'export default { resolve: { alias: { "@c": "../../cloud" } } };\n' },
    "packages/x/vitest.config.ts:1 B",
  ],
  [
    "Dockerfile COPY cloud/…",
    { "packages/x/Dockerfile": "FROM busybox\n# COPY nothing\nCOPY cloud/web/package.json cloud/web/\n" },
    "packages/x/Dockerfile:3 B",
  ],
  ["compose build.context cloud/…", { "compose.x.yml": "services:\n  a:\n    build:\n      context: cloud/agent\n" }, "compose.x.yml:4 B"],
  [
    "dependency on @oab/cloud-web",
    { "packages/x/package.json": '{\n  "name": "x",\n  "dependencies": { "@oab/cloud-web": "*" }\n}\n' },
    "packages/x/package.json:3 B",
  ],
  ["bare @oab/cloud", { "packages/x/src/a.ts": 'import x from "@oab/cloud";\nexport default x;\n' }, "packages/x/src/a.ts:1 A"],
  ["bare @oab/cloud/agent", { "packages/x/src/a.ts": 'import x from "@oab/cloud/agent";\nexport default x;\n' }, "packages/x/src/a.ts:1 A"],
  ["export * from a parent cloud/ folder", { "packages/x/a.ts": 'export * from "../../cloud/x";\n' }, "packages/x/a.ts:1 A"],
  [
    "bare @oab/cloud-agent/x",
    { "packages/x/src/a.ts": 'import x from "@oab/cloud-agent/x";\nexport default x;\n' },
    "packages/x/src/a.ts:1 A",
  ],
  ["Rule C string", { "packages/x/src/a.ts": 'export const p = "../cloud/web/app";\n' }, "packages/x/src/a.ts:1 C"],
  ["upper-case path", { "packages/x/src/a.ts": 'import x from "../../../Cloud/agent/x";\nexport default x;\n' }, "packages/x/src/a.ts:1 A"],
  [
    "join(ROOT, 'cloud')",
    { "scripts/a.mjs": 'import { join } from "node:path";\nexport const p = join(ROOT, "cloud");\n' },
    "scripts/a.mjs:2 C",
  ],
  [
    "resolve(ROOT, 'CLOUD', 'web')",
    { "scripts/a.mjs": 'import path from "node:path";\nexport const p = path.resolve(ROOT, "CLOUD", "web");\n' },
    "scripts/a.mjs:2 C",
  ],
  ["new URL('cloud', …)", { "scripts/a.mjs": 'export const u = new URL("cloud", import.meta.url);\n' }, "scripts/a.mjs:1 C"],
  ["literal 'cloud/'", { "scripts/a.mjs": "export const p = `cloud/`;\n" }, "scripts/a.mjs:1 C"],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text that holds a template literal
  ["template with interpolation", { "scripts/a.mjs": "export const p = (r) => `${r}/cloud/deploy/x`;\n" }, "scripts/a.mjs:1 C"],
  ["shell word", { "scripts/x.sh": "#!/bin/sh\n# cat cloud/deploy/y\ncat cloud/deploy/x\n" }, "scripts/x.sh:3 C"],
  ["shell path expression", { "e2e/x.sh": 'rm -rf "$ROOT/cloud"\n' }, "e2e/x.sh:1 C"],
  ["local/** path token", { "local/searxng/Dockerfile": "FROM busybox\nCOPY ../../cloud/deploy/x /x\n" }, "local/searxng/Dockerfile:2 B"],
  [
    "package.json script path",
    { "packages/x/package.json": '{\n  "scripts": { "t": "node ../../cloud/deploy/t.mjs" }\n}\n' },
    "packages/x/package.json:2 B",
  ],
  ["tsconfig files", { "packages/x/tsconfig.json": '{ "files": ["../../cloud/agent/src/a.ts"] }\n' }, "B"],
  [
    "Rule C string naming any cloud/ folder",
    { "packages/x/src/a.ts": 'export const p = "cloud/newpkg/x";\n', "cloud/newpkg/x": "x\n" },
    "packages/x/src/a.ts:1 C",
  ],
  [
    "join(ROOT, '../cloud')",
    { "scripts/a.mjs": 'import { join } from "node:path";\nexport const p = join(ROOT, "../cloud");\n' },
    "scripts/a.mjs:2 C",
  ],
  ["shell word in a .sh file outside scripts/ and e2e/", { "local/x/run.sh": "#!/bin/sh\ncat cloud/deploy/x\n" }, "local/x/run.sh:2 C"],
  ["shell word in an extensionless shebang script", { "bin/tool": "#!/usr/bin/env bash\ncp cloud/web/x y\n" }, "bin/tool:2 C"],
  ["string in an extensionless node script", { "bin/tool": '#!/usr/bin/env node\nconst p = "cloud/web/x";\n' }, "bin/tool:2 C"],
];

describe("cloud boundary: each injected case fails with its own rule", () => {
  for (const [name, files, expected] of FAILING) {
    it(name, () => {
      const got = rules(violations(files));
      assert.ok(
        got.some((g) => g === expected || g.endsWith(` ${expected}`)),
        `${expected} not in ${JSON.stringify(got)}`,
      );
    });
  }

  it("an absolute import specifier into cloud/", () => {
    const root = repo({});
    writeFileSync(join(root, "a.ts"), `import x from "${join(root, "cloud/agent/src/a.ts")}";\nexport default x;\n`);
    execFileSync("git", ["add", "-A"], { cwd: root });
    assert.deepEqual(rules(checkRepo(root).violations), ["a.ts:1 A"]);
  });

  it("an absolute string literal into cloud/", () => {
    const root = repo({});
    writeFileSync(join(root, "a.mjs"), `export const p = "${join(root, "cloud")}";\n`);
    execFileSync("git", ["add", "-A"], { cwd: root });
    assert.deepEqual(rules(checkRepo(root).violations), ["a.mjs:1 C"]);
  });

  it("the root package.json allow entry covers only the cloud/* workspaces token", () => {
    const allow = JSON.parse(readFileSync(join(ROOT, "scripts/boundary/allow.json"), "utf8")).filter((e) => e.file === "package.json");
    assert.equal(allow.length, 1);
    const pkg = (extra) => `${JSON.stringify({ name: "root", workspaces: ["packages/*", "cloud/*"], ...extra }, null, 2)}\n`;
    assert.deepEqual(rules(violations({ "package.json": pkg({}) }, { allow })), []);
    assert.deepEqual(rules(violations({ "package.json": pkg({ dependencies: { "@oab/cloud-web": "file:cloud/web" } }) }, { allow })), [
      "package.json:8 B",
      "package.json:8 B",
    ]);
    assert.deepEqual(rules(violations({ "package.json": pkg({ scripts: { start: "node cloud/agent/dist/server.js" } }) }, { allow })), [
      "package.json:8 B",
    ]);
    assert.deepEqual(rules(violations({ "package.json": pkg({ scripts: { wipe: "rm -rf cloud/*" } }) }, { allow })), ["package.json:8 B"]);
  });

  it("a tracked symlink into cloud/", () => {
    assert.deepEqual(rules(violations({}, { links: { "packages/x/src/link": "../../../cloud/agent/src" } })), ["packages/x/src/link:1 D"]);
  });

  it("a symlink to <root>/cloud itself", () => {
    assert.deepEqual(rules(violations({}, { links: { lnk: "cloud" } })), ["lnk:1 D"]);
  });

  it("an absolute-target symlink into cloud/", () => {
    assert.deepEqual(rules(violations({}, { links: { "packages/x/abs": (root) => join(root, "cloud/agent/src/a.ts") } })), [
      "packages/x/abs:1 D",
    ]);
  });

  it("a chain of symlinks that ends in cloud/", () => {
    const got = rules(violations({}, { links: { "packages/x/one": "two", "packages/x/two": "../../cloud/agent" } }));
    assert.deepEqual(got.sort(), ["packages/x/one:1 D", "packages/x/two:1 D"]);
  });

  it("an allowlisted file that imports cloud code still fails Rule A", () => {
    const allow = [{ file: "scripts/test/x.test.mjs", reason: "fixture-only names" }];
    const got = violations(
      { "scripts/test/x.test.mjs": 'import x from "../../cloud/agent/x.mjs";\nexport const s = "cloud/web/y";\n' },
      { allow },
    );
    assert.deepEqual(rules(got), ["scripts/test/x.test.mjs:1 A"]);
  });

  it("a cloud/*/package.json whose name does not start with @oab/cloud-", () => {
    assert.deepEqual(rules(violations({ "cloud/x/package.json": '{"name":"foo"}\n' })), ["cloud/x/package.json:1 D"]);
  });

  it("a bare import of a cloud package by its own name", () => {
    const got = violations({ "cloud/x/package.json": '{"name":"@oab/cloud-x"}\n', "packages/x/src/a.ts": 'import "@oab/cloud-x";\n' });
    assert.deepEqual(rules(got), ["packages/x/src/a.ts:1 A"]);
  });

  it("the case-insensitive compare also covers resolved Rule B tokens", () => {
    assert.deepEqual(rules(violations({ "packages/x/Dockerfile": "FROM busybox\nCOPY CLOUD/web /w\n" })), ["packages/x/Dockerfile:2 B"]);
  });
});

describe("cloud boundary: passing cases", () => {
  const PASSING = [
    ["@google-cloud/storage", { "packages/x/src/a.ts": 'import s from "@google-cloud/storage";\nexport default s;\n' }],
    [
      "./cloudy.ts",
      { "packages/x/src/a.ts": 'import c from "./cloudy.ts";\nexport default c;\n', "packages/x/src/cloudy.ts": "export default 1;\n" },
    ],
    [
      "packages/x/src/cloud-icons.ts",
      { "packages/x/src/cloud-icons.ts": 'export const kind = "cloud";\n', "packages/x/src/a.ts": 'import "./cloud-icons.ts";\n' },
    ],
    [
      "a glob **/cloud/** in a lint config",
      { "packages/x/eslint.config.mjs": 'export default [{ patterns: ["**/cloud/**", "**/cloud"] }];\n' },
    ],
    ["a glob **/cloud/** in a biome config", { "e2e/biome.json": '{ "group": ["**/cloud", "**/cloud/**"] }\n' }],
    [
      "dynamic import() of @google-cloud/storage",
      { "packages/x/src/a.ts": 'export const load = () => import("@google-cloud/storage");\n' },
    ],
    [
      "./cloudinary.ts and ../clouds/x",
      {
        "packages/x/src/a.ts": 'import c from "./cloudinary.ts";\nimport d from "../clouds/x";\nexport default [c, d];\n',
        "packages/x/src/cloudinary.ts": "export default 1;\n",
        "packages/x/clouds/x.ts": "export default 2;\n",
      },
    ],
    ["package-lock.json keys", { "package-lock.json": '{ "packages": { "cloud/agent": { "name": "@oab/cloud-agent" } } }\n' }],
    ["a comment", { "packages/x/src/a.ts": '// import "../../../cloud/agent/src/a.ts"\n/* cloud/web/app */\nexport const a = 1;\n' }],
    ["a shell comment", { "scripts/x.sh": "#!/bin/sh\n# rm -rf cloud/deploy\necho ok\n" }],
    [
      "a file inside cloud/ importing packages/",
      {
        "cloud/agent/src/b.ts": 'import x from "../../../packages/core/src/x.ts";\nexport default x;\n',
        "packages/core/src/x.ts": "export default 1;\n",
      },
    ],
    [
      "a cloud provider kind string",
      { "packages/x/src/a.ts": 'export const kind = "cloud" as const;\nexport const label = "Cloud models";\n' },
    ],
    ["a path to a sibling named cloud inside a package", { "packages/x/Dockerfile": "FROM busybox\nCOPY ./cloud-x /x\n" }],
    ["a Markdown file", { "docs/x.md": "Hosted code lives in `cloud/agent` and `../cloud/web`.\n" }],
    ["a YAML file outside Rule B", { ".github/workflows/x.yml": "run: rm -rf cloud/web\n" }],
    ["an untouched docs/superpowers spec", { "docs/superpowers/specs/x.ts": 'import "../../../cloud/agent/src/a.ts";\n' }],
  ];
  for (const [name, files] of PASSING) it(name, () => assert.deepEqual(rules(violations(files)), []));

  it("an allowlisted file with a Rule C string", () => {
    const allow = [{ file: "scripts/test/x.test.mjs", reason: "fixture-only names" }];
    const r = checkRepo(repo({ "scripts/test/x.test.mjs": 'export const s = "cloud/web/y";\n' }, { allow }));
    assert.deepEqual(r.violations, []);
    assert.deepEqual(
      r.allowed.map((a) => [a.file, a.rule, a.reason]),
      [["scripts/test/x.test.mjs", "C", "fixture-only names"]],
    );
  });

  it("a line-level allow entry exempts only its line", () => {
    const allow = [{ file: "scripts/a.mjs", line: 1, reason: "one line" }];
    const got = violations({ "scripts/a.mjs": 'export const a = "cloud/web/a";\nexport const b = "cloud/web/b";\n' }, { allow });
    assert.deepEqual(rules(got), ["scripts/a.mjs:2 C"]);
  });

  it("allow entries ending in /** cover their folder, case-insensitively", () => {
    const allow = [{ file: "scripts/boundary/**", reason: "the checker" }];
    assert.deepEqual(rules(violations({ "scripts/boundary/x.mjs": 'export const a = "cloud/";\n' }, { allow })), []);
    assert.deepEqual(rules(violations({ "Scripts/Boundary/x.mjs": 'export const a = "cloud/";\n' }, { allow })), []);
  });

  it("a field and token pinned entry exempts only that field and token", () => {
    const allow = [{ file: "packages/x/package.json", field: "workspaces", token: "../../cloud/*", reason: "pinned" }];
    const text = '{\n  "workspaces": ["../../cloud/*"],\n  "files": ["../../cloud/*"]\n}\n';
    assert.deepEqual(rules(violations({ "packages/x/package.json": text }, { allow })), ["packages/x/package.json:2 B"]);
  });
});

describe("cloud-boundary.mjs CLI", () => {
  it("prints the summary and one VIOLATION line per hit, exit 1", () => {
    const root = repo({ "packages/x/src/a.ts": 'import x from "../../../cloud/agent/src/a.ts";\nexport default x;\n' });
    const r = spawnSync(process.execPath, [CHECKER, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^cloud-boundary: \d+ files, 1 violations\n/);
    assert.match(
      r.stdout,
      /^VIOLATION packages\/x\/src\/a\.ts:1 A \.\.\/\.\.\/\.\.\/cloud\/agent\/src\/a\.ts -> cloud\/agent\/src\/a\.ts$/m,
    );
  });

  it("exit 0 on a clean tree; the files under cloud/ and docs/superpowers/ are not counted", () => {
    const root = repo({ "packages/x/src/a.ts": "export const a = 1;\n", "docs/superpowers/x.md": "x\n" });
    const r = spawnSync(process.execPath, [CHECKER, "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.stdout, "cloud-boundary: 1 files, 0 violations\n");
  });

  it("root npm run lint runs it", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(pkg.scripts["lint:boundary"], "node scripts/boundary/cloud-boundary.mjs");
    assert.match(pkg.scripts.lint, /&& npm run lint:boundary$/);
  });
});

describe("allow.json", () => {
  const allow = JSON.parse(readFileSync(join(ROOT, "scripts/boundary/allow.json"), "utf8"));
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

  it("every entry exempts at least one hit in this repo", () => {
    const { allowed } = checkRepo(ROOT, { allow });
    for (const e of allow)
      assert.ok(
        allowed.some((a) => a.reason === e.reason && a.file.toLowerCase().startsWith(e.file.replace(/\*\*$/, "").toLowerCase())),
        `allow entry ${e.file} exempts nothing`,
      );
  });

  it("every entry names a file (or folder/**) outside cloud/ and gives a reason", () => {
    assert.ok(Array.isArray(allow) && allow.length > 0);
    for (const e of allow) {
      assert.equal(typeof e.file, "string", JSON.stringify(e));
      assert.ok(!/^cloud(\/|$)/i.test(e.file), e.file);
      assert.ok(typeof e.reason === "string" && e.reason.trim().length > 10, `${e.file} needs a reason`);
      assert.deepEqual(
        Object.keys(e).filter((k) => !["file", "line", "field", "token", "reason"].includes(k)),
        [],
        `${e.file}: only file, line, field, token, reason`,
      );
      if (e.line !== undefined) assert.ok(Number.isInteger(e.line) && e.line > 0, e.file);
    }
  });

  it("every entry still matches a tracked file", () => {
    for (const e of allow) {
      const hit = e.file.endsWith("/**") ? tracked.some((f) => f.startsWith(e.file.slice(0, -2))) : tracked.includes(e.file);
      assert.ok(hit, `stale allow entry ${e.file}`);
    }
  });
});
