import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = mkdtempSync(join(tmpdir(), "makefile-"));
after(() => rmSync(WORK, { recursive: true, force: true }));
const SECRET = "dummy-secret-7c41e0";
const HOSTED = existsSync(join(ROOT, "cloud/deploy/compose.hosted.yml"));
const STANDALONE = !HOSTED && "cloud/ is removed in the standalone check";

let n = 0;
function fakeBin({ dockerInfo = 0, dockerPs = "" } = {}) {
  const bin = join(WORK, `bin-${n++}`);
  const log = join(bin, "calls.log");
  mkdirSync(bin);
  const tool = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  tool("docker", `case "$1" in info) exit ${dockerInfo} ;; ps) printf '%s' "${dockerPs}" ;; esac\nexit 0`);
  tool("npm", "exit 0");
  tool("pgrep", "exit 1");
  tool("osascript", "exit 0");
  tool("open", "exit 0");
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

const make = (args, { bin, env = {} } = {}) => {
  const r = spawnSync("make", ["--no-print-directory", ...args], {
    cwd: ROOT,
    env: { PATH: bin ? `${bin}:${process.env.PATH}` : process.env.PATH, HOME: process.env.HOME, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

function envDir(files) {
  const dir = join(WORK, `env-${n++}`);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text, { mode: 0o600 });
  }
  return dir;
}

const FULL_BACKEND = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "AGENT_SERVICE_SECRET",
  "CREDENTIAL_KEYS",
  "ACCESS_REQUEST_PEPPER",
  "APP_ORIGIN",
  "RENDERER_SECRET",
]
  .map((k) => `${k}=${SECRET}\n`)
  .join("");
const FULL_FRONTEND = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "AGENT_SERVICE_SECRET"]
  .map((k) => `${k}=${SECRET}\n`)
  .join("");

describe("Makefile", () => {
  it("has help, run, app, web and stop, and help is the default", () => {
    const text = readFileSync(join(ROOT, "Makefile"), "utf8");
    for (const t of ["help", "run", "app", "web", "stop"]) assert.match(text, new RegExp(`^${t}:`, "m"), t);
    const r = make([]);
    assert.equal(r.status, 0, r.out);
    for (const s of ["make run app", "make run web", "make stop", "make help"]) assert.ok(r.out.includes(s), s);
    assert.deepEqual(
      text.split("\n").filter((l) => l.trim().startsWith("#")),
      [],
      "no comments",
    );
  });

  it("runs app for `make run app` and web for `make run web`, and `make run` alone shows help", () => {
    assert.deepEqual(make(["-n", "run", "app"]).out.trim().split("\n"), [":", "bash scripts/make/app.sh"]);
    assert.deepEqual(make(["-n", "run", "web"]).out.trim().split("\n"), [":", "bash scripts/make/web.sh"]);
    assert.deepEqual(make(["-n", "app"]).out.trim().split("\n"), ["bash scripts/make/app.sh"]);
    assert.deepEqual(make(["-n", "web"]).out.trim().split("\n"), ["bash scripts/make/web.sh"]);
    assert.deepEqual(make(["-n", "stop"]).out.trim().split("\n"), ["bash scripts/make/stop.sh"]);
    assert.ok(make(["run"]).out.includes("make run app"));
  });

  it("app stops before npm with a clear error when Docker is not running", () => {
    const f = fakeBin({ dockerInfo: 1 });
    const r = make(["run", "app"], { bin: f.bin });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /make app: Docker is not running/);
    assert.equal(f.calls().includes("npm"), false, f.calls());
  });

  it("stop takes the oab-preview project down without -v and leaves other projects alone", () => {
    const f = fakeBin({ dockerPs: "abc123" });
    const r = make(["stop"], { bin: f.bin });
    assert.equal(r.status, 0, r.out);
    const down = f
      .calls()
      .split("\n")
      .filter((l) => l.includes(" down"));
    assert.equal(down.length, 1, f.calls());
    assert.match(
      down[0],
      /^docker compose -p oab-preview --env-file \/dev\/null -f cloud\/deploy\/compose\.hosted\.yml -f cloud\/deploy\/compose\.preview\.yml --profile local down$/,
    );
    assert.match(f.calls(), /^docker stop abc123$/m);
    assert.doesNotMatch(f.calls(), / -v\b|--volumes|open-agent-bot/);
  });

  it("stop does nothing when nothing runs", () => {
    const f = fakeBin();
    const r = make(["stop"], { bin: f.bin });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /oab-preview is not running/);
    assert.doesNotMatch(f.calls(), / down| stop /);
  });
});

describe("make web sanity check", { skip: STANDALONE }, () => {
  const refused = (dir, ...want) => {
    const f = fakeBin();
    const r = make(["run", "web"], { bin: f.bin, env: { ENV_DIR: dir } });
    assert.notEqual(r.status, 0, r.out);
    for (const w of want) assert.ok(r.out.includes(w), `${w}\n${r.out}`);
    assert.ok(r.out.includes("cloud/deploy/scripts/env-files.mjs"), r.out);
    assert.equal(r.out.includes(SECRET), false);
    assert.equal(f.calls().includes("docker"), false, f.calls());
    return r;
  };

  it("refuses when the env files are missing, naming each file and its .env.example", () => {
    const dir = envDir({});
    refused(dir, "backend/.env is missing", "frontend/.env is missing", "backend/.env.example");
  });

  it("refuses when required names are missing or empty, listing names only", () => {
    const dir = envDir({
      "backend/.env": `SUPABASE_URL=${SECRET}\nSUPABASE_SECRET_KEY=\n`,
      "frontend/.env": `NEXT_PUBLIC_SUPABASE_URL=${SECRET}\n`,
    });
    const r = refused(
      dir,
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "RENDERER_SECRET",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "frontend/.env.example",
    );
    assert.doesNotMatch(r.out, /lacks a value for: [^\n]*SUPABASE_URL,/);
  });

  it("refuses a different AGENT_SERVICE_SECRET in the two files", () => {
    const dir = envDir({
      "backend/.env": FULL_BACKEND,
      "frontend/.env": FULL_FRONTEND.replace(`AGENT_SERVICE_SECRET=${SECRET}`, `AGENT_SERVICE_SECRET=${SECRET}-other`),
    });
    refused(dir, "AGENT_SERVICE_SECRET differs");
  });

  it("passes complete files on to the Docker check, warning by name about backend names no container receives", () => {
    const dir = envDir({ "backend/.env": `${FULL_BACKEND}SEARXNG_URL=${SECRET}\n`, "frontend/.env": FULL_FRONTEND });
    const f = fakeBin({ dockerInfo: 1 });
    const r = make(["web"], { bin: f.bin, env: { ENV_DIR: dir } });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /every required name/);
    assert.match(r.out, /no container receives: SEARXNG_URL/);
    assert.match(r.out, /make web: Docker is not running/);
    assert.equal(r.out.includes(SECRET), false);
    assert.equal(f.calls().trim(), "docker info");
  });
});
