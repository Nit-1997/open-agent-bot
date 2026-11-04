import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isImportLine, isPathLine, verifyMove } from "../move/verify-move.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = mkdtempSync(join(tmpdir(), "verify-move-"));
after(() => rmSync(WORK, { recursive: true, force: true }));

const ROWS = [
  { old: "deploy-config", new: "cloud/deploy", pr: "6.6", allow: [] },
  { old: "web", new: "cloud/web", pr: "6.5", allow: [] },
];

let n = 0;
function fixture() {
  const root = join(WORK, String(n++));
  mkdirSync(root, { recursive: true });
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8" });
  const write = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  };
  const commit = (msg) => {
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", msg);
    return git("rev-parse", "HEAD").trim();
  };
  git("init", "-q");
  return { root, git, write, commit };
}

const BASE_FILES = {
  "web/app/a.ts": 'import { x } from "../../packages/ui/src/x.ts";\nexport const n = 1;\nexport const p = "../../packages/ui/src";\n',
  "web/app/globals.css": '@import "tailwindcss";\n@source "../../packages/ui/src";\n',
  "web/test/fonts.test.ts": 'const a = join(REPO, "web", "web/app/fonts");\nconst k = readFileSync("deploy-config/.env-agent");\n',
  "web/README.md": "Run it.\nKeys live in deploy-config/.env-nextjs (see `deploy-config/env.examples`).\n",
  "web/server.ts": 'import "./a.ts";\n',
  "packages/core/src/server.ts": 'import "./hosted/main.js";\n',
  "package.json": '{ "workspaces": ["web"] }\n',
};

function moved({ c1Edit, c2Files, deleteServer = false } = {}) {
  const f = fixture();
  f.write(BASE_FILES);
  const base = f.commit("base");
  mkdirSync(join(f.root, "cloud"), { recursive: true });
  f.git("mv", "web", "cloud/web");
  if (deleteServer) f.git("rm", "-q", "packages/core/src/server.ts");
  if (c1Edit) f.write(c1Edit);
  const c1 = f.commit("move");
  f.write({ "scripts/boundary/moved-paths.json": JSON.stringify(ROWS), ...(c2Files ?? {}) });
  const c2 = f.commit("wiring");
  return { ...f, base, c1, c2 };
}

const WIRED = {
  "cloud/web/app/a.ts":
    'import { x } from "../../../packages/ui/src/x.ts";\nexport const n = 1;\nexport const p = "../../../packages/ui/src";\n',
  "cloud/web/app/globals.css": '@import "tailwindcss";\n@source "../../../packages/ui/src";\n',
  "cloud/web/test/fonts.test.ts":
    'const a = join(REPO, "cloud/web", "cloud/web/app/fonts");\nconst k = readFileSync("cloud/deploy/.env-agent");\n',
  "cloud/web/README.md": "Run it.\nKeys live in cloud/deploy/.env-nextjs (see `cloud/deploy/env.examples`).\n",
  "cloud/web/package.json": '{ "name": "@oab/cloud-web" }\n',
  "package.json": '{ "workspaces": ["cloud/*"] }\n',
};

describe("verify-move.mjs", () => {
  it("counts R100 renames, import lines and path lines; other=0", () => {
    const m = moved({ deleteServer: true, c2Files: WIRED });
    const r = verifyMove({
      cwd: m.root,
      base: m.base,
      c1: m.c1,
      c2: m.c2,
      moved: ["cloud/web"],
      deleted: ["packages/core/src/server.ts"],
      allow: ["cloud/web/package.json"],
    });
    assert.deepEqual(r.other, []);
    assert.equal(r.renames, 5);
    assert.equal(r.importLines, 1);
    assert.equal(r.pathLines.length, 5);
    assert.match(r.text, /^renames=5 import-lines=1 path-lines=5 other=0$/m);
    assert.match(r.text, /^PATH cloud\/web\/app\/globals\.css:2: \.\.\/\.\.\/packages\/ui\/src -> \.\.\/\.\.\/\.\.\/packages\/ui\/src$/m);
    assert.match(r.text, /^PATH cloud\/web\/test\/fonts\.test\.ts:1: web -> cloud\/web, web\/app\/fonts -> cloud\/web\/app\/fonts$/m);
    assert.match(r.text, /^PATH cloud\/web\/test\/fonts\.test\.ts:2: deploy-config\/\.env-agent -> cloud\/deploy\/\.env-agent$/m);
    assert.match(r.text, /^PATH cloud\/web\/README\.md:2: /m);
  });

  it("a non-path edit inside a moved directory is other", () => {
    const m = moved({ c2Files: { "cloud/web/app/a.ts": BASE_FILES["web/app/a.ts"].replace("n = 1", "n = 2") } });
    const r = verifyMove({ cwd: m.root, base: m.base, c1: m.c1, c2: m.c2, moved: ["cloud/web"] });
    assert.equal(r.other.length, 1);
    assert.match(r.other[0], /^cloud\/web\/app\/a\.ts:2: export const n = 1; => export const n = 2;$/);
  });

  it("a rename that also edits the file (not R100) is other", () => {
    const edited = `${BASE_FILES["web/app/a.ts"]}export const extra = true;\n`;
    const m = moved({ c1Edit: { "cloud/web/app/a.ts": edited } });
    const r = verifyMove({ cwd: m.root, base: m.base, c1: m.c1, c2: m.c2, moved: ["cloud/web"] });
    assert.equal(r.renames, 4);
    assert.ok(
      r.other.some((o) => /^commit 1: R\d+ web\/app\/a\.ts -> cloud\/web\/app\/a\.ts$/.test(o) && !o.includes("R100")),
      r.other.join("\n"),
    );
  });

  it("a deletion not named with --deleted is other", () => {
    const m = moved({ deleteServer: true });
    const r = verifyMove({ cwd: m.root, base: m.base, c1: m.c1, c2: m.c2, moved: ["cloud/web"] });
    assert.deepEqual(r.other, ["commit 1: D packages/core/src/server.ts"]);
  });

  it("a new file inside a moved directory is other unless named with --allow", () => {
    const m = moved({ c2Files: { "cloud/web/new.ts": "export {};\n" } });
    const strict = verifyMove({ cwd: m.root, base: m.base, c1: m.c1, c2: m.c2, moved: ["cloud/web"] });
    assert.deepEqual(strict.other, ["cloud/web/new.ts: added inside a moved directory"]);
    const allowed = verifyMove({ cwd: m.root, base: m.base, c1: m.c1, c2: m.c2, moved: ["cloud/web"], allow: ["cloud/web/new.ts"] });
    assert.deepEqual(allowed.other, []);
  });

  it("CLI prints the counts and exits 1 when other > 0", () => {
    const m = moved({ c2Files: { "cloud/web/app/a.ts": BASE_FILES["web/app/a.ts"].replace("n = 1", "n = 2") } });
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/move/verify-move.mjs"), m.base, m.c1, m.c2, "--moved", "cloud/web"], {
      cwd: m.root,
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^renames=5 import-lines=0 path-lines=0 other=1\nOTHER cloud\/web\/app\/a\.ts:2: /);
  });

  it("CLI usage error exits 2", () => {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/move/verify-move.mjs"), "a"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^usage: verify-move\.mjs/);
  });
});

describe("line classification", () => {
  it("import lines: only the specifier changes", () => {
    assert.ok(isImportLine('import { a } from "../store/x.js";', 'import { a } from "@oab/core/store/x.js";'));
    assert.ok(isImportLine('export * from "./a.js";', 'export * from "../a.js";'));
    assert.ok(isImportLine('const m = await import("./a.js");', 'const m = await import("../a.js");'));
    assert.ok(isImportLine('const m = require("./a.cjs");', 'const m = require("../a.cjs");'));
    assert.ok(!isImportLine('import { a } from "./x.js";', 'import { a, b } from "./y.js";'));
    assert.ok(!isImportLine("const a = 1;", "const a = 2;"));
  });

  it("path lines: depth changes, moved-paths replacements and bare folder names", () => {
    assert.ok(isPathLine('  "@oab/*": ["../packages/*"],', '  "@oab/*": ["../../packages/*"],', ROWS));
    assert.ok(isPathLine("cp deploy-config/.env-agent x", "cp cloud/deploy/.env-agent x", ROWS));
    assert.ok(isPathLine('cwd: join(ROOT, "web"),', 'cwd: join(ROOT, "cloud/web"),', ROWS));
    assert.ok(!isPathLine('cwd: join(ROOT, "webview"),', 'cwd: join(ROOT, "cloud/webview"),', ROWS));
    assert.ok(!isPathLine("const a = 1;", "const a = 2;", ROWS));
    assert.ok(!isPathLine('f("a")', 'g("a")', ROWS));
    assert.ok(!isPathLine("a b", "a  b", ROWS));
  });
});
