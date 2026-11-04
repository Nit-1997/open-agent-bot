import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(ROOT, "scripts/ci/standalone.sh");
const TMP = realpathSync(tmpdir());
const WORK = mkdtempSync(join(TMP, "standalone-"));
const OUTSIDE = mkdtempSync("/var/tmp/oab-standalone-");
after(() => {
  rmSync(WORK, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

const BIN = join(WORK, "bin");
mkdirSync(BIN);
for (const tool of ["npm", "npx", "docker", "curl", "jq"]) {
  const path = join(BIN, tool);
  writeFileSync(
    path,
    `#!/bin/sh\necho "${tool} $*" >> "$FAKE_LOG"\nif [ -n "\${FAKE_FAIL:-}" ] && [ "${tool} $*" = "$FAKE_FAIL" ]; then exit 3; fi\nexit 0\n`,
  );
  chmodSync(path, 0o755);
}

const GIT = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
const git = (cwd, ...args) => execFileSync("git", [...GIT, ...args], { cwd, encoding: "utf8" });

function clone(parent, files = {}, { ignore = "" } = {}) {
  mkdirSync(parent, { recursive: true });
  const src = mkdtempSync(join(parent, "src-"));
  const all = {
    "scripts/boundary/cloud-boundary.mjs": 'console.log("cloud-boundary: stub");\n',
    ".gitignore": `node_modules/\ndist/\n${ignore}`,
    "README.md": "x\n",
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(src, path)), { recursive: true });
    writeFileSync(join(src, path), text);
  }
  git(src, "init", "-q");
  git(src, "add", "-A");
  git(src, "commit", "-q", "-m", "fixture");
  const oss = join(parent, `oss-${Math.random().toString(36).slice(2)}`);
  execFileSync("git", ["clone", "-q", src, oss]);
  return oss;
}

function run(cwd, { env = {}, args = [] } = {}) {
  const log = join(WORK, `log-${Math.random().toString(36).slice(2)}`);
  writeFileSync(log, "");
  const base = { PATH: `${BIN}:${process.env.PATH}`, HOME: process.env.HOME ?? WORK, TMPDIR: TMP, FAKE_LOG: log };
  const r = spawnSync("bash", [SCRIPT, ...args], { cwd, env: { ...base, ...env }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls: readFileSync(log, "utf8").split("\n").filter(Boolean) };
}

const ALLOW = { OAB_STANDALONE_ALLOW_DELETE: "1" };
const DOCKER = {
  ...ALLOW,
  OAB_STANDALONE_PROJECT: "oab-test-oss",
  OPEN_AGENT_PORT: "18610",
  OPEN_AGENT_DATA_VOLUME: "oab-test-oss-data",
  OPEN_AGENT_KEYS_VOLUME: "oab-test-oss-keys",
  OPEN_AGENT_IMAGE: "oab-test-oss-agent:dev",
  OPEN_AGENT_SEARCH_IMAGE: "oab-test-oss-search:dev",
  APP_ORIGIN: "http://127.0.0.1:18610",
};

const refused = (r, pattern) => {
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /standalone: refused: /);
  assert.match(r.out, pattern);
  assert.deepEqual(r.calls, []);
};

describe("standalone.sh guards", () => {
  it("refuses without OAB_STANDALONE_ALLOW_DELETE=1", () => refused(run(clone(WORK)), /OAB_STANDALONE_ALLOW_DELETE=1/));

  it("refuses an unknown argument", () => refused(run(clone(WORK), { env: ALLOW, args: ["--force"] }), /unknown argument '--force'/));

  it("refuses in a linked worktree", () => {
    const oss = clone(WORK);
    const wt = join(WORK, `wt-${Math.random().toString(36).slice(2)}`);
    git(oss, "worktree", "add", "-q", wt);
    refused(run(wt, { env: ALLOW }), /\.git is not a directory/);
  });

  it("refuses a dirty tree", () => {
    const oss = clone(WORK);
    writeFileSync(join(oss, "stray.txt"), "x\n");
    refused(run(oss, { env: ALLOW }), /not clean/);
  });

  it("refuses a checkout outside $TMPDIR, /tmp and /private/tmp", () => {
    refused(run(clone(OUTSIDE), { env: ALLOW }), /not under \$TMPDIR, \/tmp or \/private\/tmp/);
  });

  it("refuses when ignored files sit under cloud/ (they would be deleted)", () => {
    const oss = clone(WORK, { "cloud/deploy/compose.hosted.yml": "name: x\n" }, { ignore: "cloud/deploy/.env*\n" });
    writeFileSync(join(oss, "cloud/deploy/.env-agent"), "SECRET=never-printed\n");
    const r = run(oss, { env: ALLOW });
    refused(r, /ignored files under cloud\/ would be deleted: cloud\/deploy\/\.env-agent/);
    assert.doesNotMatch(r.out, /never-printed/);
    assert.ok(existsSync(join(oss, "cloud/deploy/compose.hosted.yml")));
  });

  it("refuses GITHUB_ACTIONS=true without RUNNER_TEMP", () => {
    const oss = clone(WORK);
    refused(run(oss, { env: { ...ALLOW, GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: dirname(oss) } }), /without RUNNER_TEMP/);
  });

  it("refuses GITHUB_ACTIONS=true when the checkout is outside $GITHUB_WORKSPACE", () => {
    const oss = clone(WORK);
    const ws = mkdtempSync(join(WORK, "ws-"));
    refused(run(oss, { env: { ...ALLOW, GITHUB_ACTIONS: "true", RUNNER_TEMP: WORK, GITHUB_WORKSPACE: ws } }), /not under GITHUB_WORKSPACE/);
  });

  it("accepts a macOS-style TMPDIR that resolves through a symlink", () => {
    const real = join(OUTSIDE, "private-var");
    mkdirSync(real);
    const link = join(OUTSIDE, "var-link");
    symlinkSync(real, link);
    const r = run(clone(real), { env: { ...ALLOW, TMPDIR: link } });
    assert.equal(r.status, 0, r.out);
  });

  const DOCKER_CASES = [
    ["a project name without oab-", { OAB_STANDALONE_PROJECT: "open-agent" }, /OAB_STANDALONE_PROJECT must start with oab-/],
    ["unscoped data volume", { OPEN_AGENT_DATA_VOLUME: "open-agent-data" }, /OPEN_AGENT_DATA_VOLUME must be oab-test-oss-data/],
    ["unscoped keys volume", { OPEN_AGENT_KEYS_VOLUME: "open-agent-keys" }, /OPEN_AGENT_KEYS_VOLUME must be oab-test-oss-keys/],
    [
      "a port outside 18000-19999",
      { OPEN_AGENT_PORT: "3000", APP_ORIGIN: "http://127.0.0.1:3000" },
      /OPEN_AGENT_PORT must be in 18000-19999/,
    ],
    ["an agent image tag without oab-", { OPEN_AGENT_IMAGE: "open-agent:local" }, /OPEN_AGENT_IMAGE must be an oab-…:dev tag/],
    [
      "a search image tag without oab-",
      { OPEN_AGENT_SEARCH_IMAGE: "oab-test-oss-search:latest" },
      /OPEN_AGENT_SEARCH_IMAGE must be an oab-…:dev tag/,
    ],
    ["a missing APP_ORIGIN", { APP_ORIGIN: "" }, /APP_ORIGIN must be http:\/\/127\.0\.0\.1:18610/],
  ];
  for (const [name, over, pattern] of DOCKER_CASES)
    it(`--docker refuses ${name} before deleting anything`, () => {
      const oss = clone(WORK, { "cloud/agent/a.ts": "export {};\n" });
      refused(run(oss, { env: { ...DOCKER, ...over }, args: ["--docker"] }), pattern);
      assert.ok(existsSync(join(oss, "cloud/agent/a.ts")));
    });
});

describe("standalone.sh steps", () => {
  const STEPS = ["git-rm", "status", "npm-ci", "playwright", "lint", "format", "typecheck", "test", "build", "boundary", "desktop"];

  it("a tree with no cloud/ passes step 1 with exit 0 and runs every step", () => {
    const r = run(clone(WORK), { env: ALLOW });
    assert.equal(r.status, 0, r.out);
    for (const s of STEPS) assert.match(r.out, new RegExp(`^\\[standalone ${s}\\] exit 0$`, "m"), s);
    assert.match(r.out, /cloud-boundary: stub/);
    assert.match(r.out, /^standalone: ok$/m);
    assert.deepEqual(r.calls, [
      "npm ci",
      "npx --no-install playwright install chromium",
      "npm run lint",
      "npm run format:check",
      "npm run typecheck",
      "npm test",
      "npm run build",
      "npm run build -w @oab/desktop",
      "npm run stage -w @oab/desktop",
    ]);
  });

  it("removes tracked cloud/ files with git rm; status then shows only D  cloud/… lines", () => {
    const oss = clone(WORK, { "cloud/agent/a.ts": "export {};\n", "cloud/web/b.ts": "export {};\n" });
    const r = run(oss, { env: ALLOW });
    assert.equal(r.status, 0, r.out);
    assert.equal(existsSync(join(oss, "cloud")), false);
    assert.deepEqual(git(oss, "status", "--porcelain").split("\n").filter(Boolean).sort(), ["D  cloud/agent/a.ts", "D  cloud/web/b.ts"]);
  });

  it("under GITHUB_ACTIONS inside the workspace, installs Chromium with its system deps; anything but D  cloud/… in status fails", () => {
    const oss = clone(WORK);
    writeFileSync(join(oss, "stray.txt"), "x\n");
    const r = run(oss, { env: { ...ALLOW, GITHUB_ACTIONS: "true", RUNNER_TEMP: WORK, GITHUB_WORKSPACE: dirname(oss) } });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /^\[standalone status\] exit 1$/m);
    assert.match(r.out, /\?\? stray\.txt/);
    const clean = clone(WORK);
    const ok = run(clean, { env: { ...ALLOW, GITHUB_ACTIONS: "true", RUNNER_TEMP: WORK, GITHUB_WORKSPACE: dirname(clean) } });
    assert.equal(ok.status, 0, ok.out);
    assert.ok(ok.calls.includes("npx --no-install playwright install --with-deps chromium"));
  });

  it("a failing step stops the run with its own exit code", () => {
    const r = run(clone(WORK), { env: { ...ALLOW, FAKE_FAIL: "npm run lint" } });
    assert.equal(r.status, 3);
    assert.match(r.out, /^\[standalone lint\] exit 3$/m);
    assert.doesNotMatch(r.out, /\[standalone format\]/);
  });

  it("--hosted-free passes when core has no hosted output and fails when dist/server.js exists", () => {
    const files = { "packages/core/src/a.ts": "export const a = 1;\n" };
    const okTree = clone(WORK, files);
    mkdirSync(join(okTree, "packages/core/dist"), { recursive: true });
    writeFileSync(join(okTree, "packages/core/dist/a.js"), "export const a = 1;\n");
    const ok = run(okTree, { env: ALLOW, args: ["--hosted-free"] });
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /exit 1 \(1 = no match = pass\)/);
    assert.match(ok.out, /^\[standalone hosted-free\] exit 0$/m);

    const bad = clone(WORK, files);
    mkdirSync(join(bad, "packages/core/dist"), { recursive: true });
    writeFileSync(join(bad, "packages/core/dist/server.js"), 'import "./hosted/main.js";\n');
    const r = run(bad, { env: ALLOW, args: ["--hosted-free"] });
    assert.equal(r.status, 1);
    assert.match(r.out, /packages\/core\/dist\/server\.js exists/);
    assert.match(r.out, /^\[standalone hosted-free\] exit 1$/m);
  });

  it("never runs npm prune or npm install", () => {
    const text = readFileSync(SCRIPT, "utf8");
    assert.doesNotMatch(text, /npm\s+(prune|install|i)\b/);
    assert.match(text, /git rm -rq --ignore-unmatch cloud/);
  });
});
