import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORK = realpathSync(mkdtempSync(join(tmpdir(), "web-local-")));
after(() => rmSync(WORK, { recursive: true, force: true }));
const HOSTED = existsSync(join(ROOT, "cloud/supabase/scripts/local-stack.mjs"));
const STANDALONE = !HOSTED && "cloud/ is removed in the standalone check";
const SCRIPT = "scripts/make/web-local.sh";
const ENV_SCRIPT = "scripts/make/web-local-env.mjs";
const USERS_SCRIPT = "scripts/make/web-local-users.mjs";
const EXAMPLE = "cloud/deploy-config/env-files/backend/.env.example";

let n = 0;
const fresh = (name) => {
  const d = join(WORK, `${name}-${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

function fakeBin({ docker = true, dockerInfo = 0, supabase = true, names = "" } = {}) {
  const bin = fresh("bin");
  const log = join(bin, "calls.log");
  const state = join(bin, "names.txt");
  writeFileSync(state, names);
  const tool = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  symlinkSync(process.execPath, join(bin, "node"));
  if (docker)
    tool(
      "docker",
      `case "$1" in info) exit ${dockerInfo} ;; ps) case "$*" in *Names*) cat "${state}" ;; esac ;; volume|network) cat "${state}" ;; esac\nexit 0`,
    );
  if (supabase) tool("supabase", `case "$*" in *" stop --no-backup"*) : > "${state}" ;; esac\nexit 0`);
  tool("pgrep", "exit 1");
  tool("osascript", "exit 0");
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

const run = (cmd, args, { bin, env = {} } = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: process.env.HOME, TMPDIR: WORK, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const make = (args, opts) => run("make", ["--no-print-directory", ...args], opts);

describe("make web-local refusals", { skip: STANDALONE }, () => {
  const refused = (f, pattern) => {
    const state = join(fresh("state"), "wl");
    const r = make(["run", "web-local"], { bin: f.bin, env: { WEB_LOCAL_DIR: state } });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, pattern);
    assert.equal(existsSync(state), false, "no state folder is created");
    assert.doesNotMatch(f.calls(), /^supabase /m);
    return r;
  };

  it("refuses with an install hint when docker is not installed", () => {
    const f = fakeBin({ docker: false });
    refused(f, /make web-local: Docker is not installed\. Install Docker Desktop \(https:\/\/docs\.docker\.com\/desktop\/\)/);
  });

  it("refuses when Docker is not running, before it looks for the Supabase CLI", () => {
    const f = fakeBin({ dockerInfo: 1 });
    refused(f, /make web-local: Docker is not running/);
    assert.equal(f.calls().trim(), "docker info");
  });

  it("refuses with an install hint when the Supabase CLI is missing", () => {
    const f = fakeBin({ supabase: false });
    refused(f, /make web-local: the Supabase CLI is missing\. Install it with brew install supabase\/tap\/supabase/);
    assert.equal(f.calls().trim(), "docker info");
  });

  it("refuses a state folder that is not an absolute path", () => {
    const f = fakeBin();
    const r = make(["web-local"], { bin: f.bin, env: { WEB_LOCAL_DIR: "relative/dir" } });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /WEB_LOCAL_DIR must be an absolute path/);
    assert.equal(f.calls(), "");
  });

  it("refuses a LIMIT_* override that is not a positive whole number before it starts anything", () => {
    const f = fakeBin();
    const state = join(fresh("state"), "wl");
    const r = make(["web-local"], { bin: f.bin, env: { WEB_LOCAL_DIR: state, LIMIT_REQUESTS_PER_MONTH: "5x" } });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /LIMIT_REQUESTS_PER_MONTH must be a whole number from 1 to 1000000/);
    assert.equal(existsSync(state), false);
    assert.doesNotMatch(f.calls(), /^supabase /m);
  });
});

describe("web-local generated env", { skip: STANDALONE }, () => {
  const stackEnv = () => {
    const f = join(fresh("stack"), "stack.env");
    writeFileSync(
      f,
      [
        "export OAB_SB_API_URL='http://127.0.0.1:18701'",
        "export OAB_SB_DB_URL='postgresql://postgres:postgres@127.0.0.1:18702/postgres'",
        "export OAB_SB_PUBLISHABLE_KEY='sb_publishable_testvalue'",
        "export OAB_SB_SECRET_KEY='sb_secret_testvalue'",
        "export OAB_SB_MAIL_URL='http://127.0.0.1:18704'",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    return f;
  };
  const defaults = () =>
    Object.fromEntries(
      readFileSync(join(ROOT, EXAMPLE), "utf8")
        .split("\n")
        .map((l) => /^(LIMIT_[A-Z_]+)=(\d+)$/.exec(l.trim()))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    );
  const parse = (text) =>
    Object.fromEntries(
      text
        .split("\n")
        .map((l) => /^export ([A-Z0-9_]+)='([^']*)'$/.exec(l))
        .filter(Boolean)
        .map((m) => [m[1], m[2]]),
    );
  const TRACE = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const seen = (p) => fs.appendFileSync(process.env.TRACE_FILE, String(p) + "\\n");
for (const name of ["readFileSync", "openSync", "readFile", "open", "createReadStream"]) {
  const orig = fs[name];
  fs[name] = function (p, ...rest) { seen(p); return orig.call(this, p, ...rest); };
}
const pr = fs.promises;
for (const name of ["readFile", "open"]) {
  const orig = pr[name];
  pr[name] = function (p, ...rest) { seen(p); return orig.call(this, p, ...rest); };
}
syncBuiltinESMExports();
`;
  const generate = (env = {}) => {
    const dir = fresh("gen");
    const out = join(dir, "env");
    const trace = join(dir, "trace.txt");
    const hook = join(dir, "trace.mjs");
    writeFileSync(trace, "");
    writeFileSync(hook, TRACE);
    const fakeEnvDir = fresh("envfiles");
    mkdirSync(join(fakeEnvDir, "backend"));
    writeFileSync(join(fakeEnvDir, "backend/.env"), "LIMIT_REQUESTS_PER_MONTH=777\nSUPABASE_SECRET_KEY=sb_secret_owner_real\n");
    const r = spawnSync(process.execPath, ["--import", hook, ENV_SCRIPT, "--stack", stackEnv(), "--out", out], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TRACE_FILE: trace, ENV_DIR: fakeEnvDir, ...env },
      encoding: "utf8",
    });
    return { ...r, out, reads: readFileSync(trace, "utf8").split("\n").filter(Boolean) };
  };

  it("writes a 0600 env with the stack keys, fresh secrets, Cloudflare's always-pass test keys and the example's LIMIT_* defaults", () => {
    const r = generate();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statSync(r.out).mode & 0o777, 0o600);
    const v = parse(readFileSync(r.out, "utf8"));
    assert.equal(v.OAB_SB_API_URL, "http://127.0.0.1:18701");
    assert.equal(v.OAB_SB_SECRET_KEY, "sb_secret_testvalue");
    assert.match(v.AGENT_SERVICE_SECRET, /^[0-9a-f]{64}$/);
    assert.match(v.RENDERER_SECRET, /^[0-9a-f]{64}$/);
    assert.notEqual(v.RENDERER_SECRET, v.AGENT_SERVICE_SECRET);
    assert.equal(Buffer.from(v.CREDENTIAL_KEYS.replace(/^v1:/, ""), "base64").length, 32);
    assert.equal(Buffer.from(v.ACCESS_REQUEST_PEPPER, "base64").length, 32);
    assert.equal(v.TURNSTILE_SECRET_KEY, "1x0000000000000000000000000000000AA");
    assert.equal(v.TURNSTILE_SITE_KEY, "1x00000000000000000000AA");
    const d = defaults();
    assert.deepEqual(Object.keys(d).sort(), [
      "LIMIT_REQUESTS_PER_HOUR",
      "LIMIT_REQUESTS_PER_MONTH",
      "LIMIT_RUNNING_PER_USER",
      "LIMIT_RUNNING_SERVER",
    ]);
    for (const [k, val] of Object.entries(d)) assert.equal(v[k], val, k);
    assert.doesNotMatch(r.stdout + r.stderr, /sb_secret_|sb_publishable_/);
  });

  it("takes LIMIT_* overrides from the environment", () => {
    const r = generate({ LIMIT_REQUESTS_PER_MONTH: "5", LIMIT_RUNNING_SERVER: "2" });
    assert.equal(r.status, 0, r.stderr);
    const v = parse(readFileSync(r.out, "utf8"));
    assert.equal(v.LIMIT_REQUESTS_PER_MONTH, "5");
    assert.equal(v.LIMIT_RUNNING_SERVER, "2");
    assert.equal(v.LIMIT_REQUESTS_PER_HOUR, defaults().LIMIT_REQUESTS_PER_HOUR);
  });

  it("never reads cloud/deploy-config/env-files/*/.env, even with ENV_DIR pointing at one", () => {
    const r = generate();
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.reads.some((p) => p.endsWith(EXAMPLE)),
      r.reads.join("\n"),
    );
    for (const p of r.reads) assert.doesNotMatch(p, /env-files\/[^/]+\/\.env$/, p);
    const text = readFileSync(r.out, "utf8");
    assert.doesNotMatch(text, /777|sb_secret_owner_real/);
  });

  it("refuses an invalid override and writes nothing", () => {
    const r = generate({ LIMIT_RUNNING_PER_USER: "0" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /LIMIT_RUNNING_PER_USER must be a whole number from 1 to 1000000/);
    assert.equal(existsSync(r.out), false);
  });

  it("the web-local scripts name no env file but the backend .env.example", () => {
    for (const f of [SCRIPT, ENV_SCRIPT, USERS_SCRIPT]) {
      const text = readFileSync(join(ROOT, f), "utf8");
      for (const m of text.matchAll(/env-files[^\s"'`]*/g)) assert.equal(m[0], "env-files/backend/.env.example", `${f}: ${m[0]}`);
      assert.doesNotMatch(text, /\bENV_DIR\b|\.env-(fastapi|nextjs)|ops\/\.env/, f);
    }
  });
});

describe("make stop and web-local", () => {
  it("stops the oab-m7-dev stack with local-stack.mjs and never names open-agent-bot", { skip: STANDALONE }, () => {
    const f = fakeBin({ names: "supabase_db_oab-m7-dev\n" });
    const state = join(fresh("state"), "wl");
    mkdirSync(join(state, "logs"), { recursive: true });
    writeFileSync(join(state, "env"), "export X='1'\n", { mode: 0o600 });
    const r = make(["stop"], { bin: f.bin, env: { WEB_LOCAL_DIR: state } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /\[local-stack\] oab-m7-dev stopped; no containers, volumes or networks remain/);
    assert.match(r.out, /make stop: web-local is stopped/);
    assert.equal(existsSync(state), false, "the state folder is removed");
    const calls = f.calls();
    assert.match(calls, /^supabase --workdir \S+oab-sb-oab-m7-dev stop --no-backup$/m);
    assert.doesNotMatch(calls, /open-agent-bot/);
    assert.doesNotMatch(calls, / -v\b|--volumes|volume rm|rm -f/);
  });

  it("stops the agent, web and stub processes from their pid files", { skip: STANDALONE }, () => {
    const f = fakeBin();
    const state = join(fresh("state"), "wl");
    mkdirSync(state, { recursive: true });
    const child = spawnSync("bash", ["-c", "sleep 300 > /dev/null 2>&1 & echo $!"], { encoding: "utf8" });
    const pid = Number(child.stdout.trim());
    writeFileSync(join(state, "agent.pid"), `${pid}\n`);
    const r = make(["stop"], { bin: f.bin, env: { WEB_LOCAL_DIR: state } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /make stop: stopped web-local's agent/);
    assert.throws(() => process.kill(pid, 0));
    assert.equal(existsSync(state), false);
  });

  it("does nothing for web-local when it never ran", () => {
    const f = fakeBin();
    const state = join(fresh("state"), "wl");
    const r = make(["stop"], { bin: f.bin, env: { WEB_LOCAL_DIR: state } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /make stop: web-local is not running/);
    assert.doesNotMatch(f.calls(), /^supabase /m);
    assert.doesNotMatch(f.calls(), /open-agent-bot/);
  });

  it("keeps the state folder when Docker is off, so the stack can still be removed later", { skip: STANDALONE }, () => {
    const f = fakeBin({ dockerInfo: 1 });
    const state = join(fresh("state"), "wl");
    mkdirSync(state, { recursive: true });
    const r = make(["stop"], { bin: f.bin, env: { WEB_LOCAL_DIR: state } });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Docker is not running; start it and run make stop again to remove oab-m7-dev/);
    assert.equal(existsSync(state), true);
  });
});
