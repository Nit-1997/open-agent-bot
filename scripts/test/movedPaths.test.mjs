import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadRows, rowProblems, staleHits, tokenPattern } from "../boundary/moved-paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = mkdtempSync(join(tmpdir(), "moved-paths-"));
after(() => rmSync(WORK, { recursive: true, force: true }));

let n = 0;
function repo(files) {
  const root = join(WORK, String(n++));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
}

const ROW = {
  old: "deploy-config",
  new: "cloud/deploy",
  pr: "6.6",
  allow: [
    { file: ".gitignore", reason: "legacy ignore lines stay on purpose" },
    { file: "scripts/boundary/**", reason: "the checkers name the old paths" },
  ],
};

describe("moved-paths.json (the rows of the repo)", () => {
  const rows = loadRows(ROOT);

  it("is a list of {old, new, pr, allow:[{file, reason}]}", () => assert.deepEqual(rowProblems(rows), []));

  it("no old path is still tracked or named as a token outside docs/superpowers and each row's allow list", () => {
    const hits = staleHits(ROOT, rows).map((h) => `${h.kind} ${h.file}:${h.line} ${h.old}`);
    assert.deepEqual(hits, []);
  });
});

describe("the stale-path guard", () => {
  it("token: not preceded by [\\w@./-]; followed by /, end, a quote, a space or )", () => {
    const re = tokenPattern("deploy-config");
    for (const yes of [
      "deploy-config/.env-agent",
      'f("deploy-config")',
      "'deploy-config'",
      "`deploy-config`",
      "see deploy-config here",
      "(deploy-config)",
      "deploy-config",
    ])
      assert.ok(re.test(yes), yes);
    for (const no of [
      "my-deploy-config/x",
      "./deploy-config/x",
      "a/deploy-config/x",
      "@deploy-config",
      "deploy-configs",
      "deploy-config.md",
      "x_deploy-config",
    ])
      assert.ok(!re.test(no), no);
  });

  it("reports stale tokens with file and line, skips docs/superpowers and allow-listed files", () => {
    const root = repo({
      "README.md": "intro\nput keys in deploy-config/.env-agent\n",
      "scripts/x.mjs": 'export const a = "deploy-config";\nexport const b = "my-deploy-config";\n',
      ".gitignore": "deploy-config/.env*\n",
      "scripts/boundary/y.mjs": 'export const c = "deploy-config";\n',
      "docs/superpowers/specs/s.md": "deploy-config/\n",
    });
    const hits = staleHits(root, [ROW]).map((h) => `${h.kind} ${h.file}:${h.line}`);
    assert.deepEqual(hits.sort(), ["STALE README.md:2", "STALE scripts/x.mjs:1"]);
  });

  it("reports an old path that is still tracked", () => {
    const root = repo({ "deploy-config/caddy/Caddyfile": ":80\n" });
    assert.deepEqual(
      staleHits(root, [ROW]).map((h) => `${h.kind} ${h.file}`),
      ["TRACKED deploy-config/caddy/Caddyfile"],
    );
  });

  it("validates rows", () => {
    assert.deepEqual(rowProblems([ROW]), []);
    assert.deepEqual(rowProblems({}), ["moved-paths.json must be an array"]);
    const bad = rowProblems([{ old: "", new: "cloud/x", pr: "7.1", allow: [{ file: "a" }] }]);
    assert.deepEqual(bad, ["row 0: old must be a non-empty string", "row 0: pr must look like 6.<n>", "row 0 allow 0: needs a reason"]);
  });

  it("the CLI prints the count and exits 1 on a stale token", () => {
    const root = repo({
      "scripts/boundary/moved-paths.json": JSON.stringify([ROW]),
      "README.md": "deploy-config/.env-agent\n",
    });
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/boundary/moved-paths.mjs"), "--root", root], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "moved-paths: 1 rows, 1 stale\nSTALE README.md:1 deploy-config\n");
  });
});
