#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertReleaseLock } from "../../../scripts/release/releaseLib.mjs";
import {
  checkFuses,
  checkPlist,
  composeStopRecorded,
  composeSubcommands,
  dmgNameProblems,
  launchTargetProblems,
  licenseProblems,
  loggedPullProblems,
  loggedPulls,
  parseFuses,
  pullProblems,
  refVersionsFor,
  releaseArgProblems,
  releaseStaticProblems,
  sizeProblems,
  smokeEnv,
  statusProblems,
} from "./packagedSmokeLib.mjs";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP_DIR, "../..");
const FAKE_DIR = join(APP_DIR, "test/fake-docker");
const { values } = parseArgs({
  options: {
    app: { type: "string", multiple: true },
    dmg: { type: "string", multiple: true },
    static: { type: "boolean" },
    docker: { type: "string" },
    services: { type: "string" },
    project: { type: "string" },
    range: { type: "string" },
    moved: { type: "boolean" },
    "local-build": { type: "boolean" },
    release: { type: "string" },
    "expect-lock": { type: "string" },
    evidence: { type: "string" },
    timeout: { type: "string" },
  },
});
const apps = values.app ?? [];
if (apps.length === 0) {
  process.stderr.write("packaged smoke: pass --app <path to .app> at least once\n");
  process.exit(2);
}
const realDocker = values.docker;
const release = values.release;
for (const p of releaseArgProblems(release)) {
  process.stderr.write(`packaged smoke: ${p}\n`);
  process.exit(2);
}
if (values["expect-lock"] && !release) {
  process.stderr.write("packaged smoke: --expect-lock needs --release <version>\n");
  process.exit(2);
}
if (release && (values.services || values["local-build"])) {
  process.stderr.write("packaged smoke: --release launches with the bundled lock; drop --services and --local-build\n");
  process.exit(2);
}
if (realDocker && !values.services && !values["local-build"] && !release) {
  process.stderr.write(
    "packaged smoke: --docker needs --services <dev services file>, --local-build (the bundled kind:local lock) or --release <version> (the bundled release lock)\n",
  );
  process.exit(2);
}
if (values.moved && realDocker) {
  process.stderr.write("packaged smoke: --moved runs with the fake docker CLI only\n");
  process.exit(2);
}

const run = (cmd, args, env) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...(env ? { env } : {}) });
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const du = (p) => walk(p).reduce((n, f) => n + (lstatSync(f).isFile() ? lstatSync(f).size : 0), 0);
const version = release ?? JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")).version;
const expectLock = values["expect-lock"] ? readFileSync(resolve(values["expect-lock"])) : undefined;
const repoLicense = readFileSync(join(REPO, "LICENSE"));
const bundledLocks = new Map();
const EXPECTED_ARCH = { "mac-arm64": "arm64", mac: "x86_64" };
const dmgFor = (arch) => (values.dmg ?? []).find((d) => d.endsWith(`-${arch === "x86_64" ? "x64" : arch}.dmg`));
const say = (m) => process.stdout.write(`${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return undefined;
  }
};
const readIf = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const readIfBuffer = (p) => (existsSync(p) ? readFileSync(p) : undefined);

const problems = [];
if (release) for (const d of dmgNameProblems(values.dmg ?? [], release)) problems.push(d);
const archOf = new Map();
for (const appPath of apps) {
  const name = relative(process.cwd(), appPath);
  const p = (msg) => problems.push(`${name}: ${msg}`);
  if (!existsSync(appPath)) {
    p("does not exist");
    continue;
  }
  const fuses = run(process.execPath, [join(REPO, "node_modules/@electron/fuses/dist/bin.js"), "read", "--app", appPath]);
  if (fuses.status !== 0) p(`@electron/fuses read exited ${fuses.status}: ${fuses.stderr.trim()}`);
  for (const f of checkFuses(parseFuses(fuses.stdout))) p(f);

  const plistJson = run("plutil", ["-convert", "json", "-o", "-", join(appPath, "Contents/Info.plist")]);
  if (plistJson.status !== 0) p(`plutil exited ${plistJson.status}`);
  else for (const f of checkPlist(JSON.parse(plistJson.stdout), version)) p(f);

  const lipo = run("lipo", ["-archs", join(appPath, "Contents/MacOS/Open Agent")]);
  const arch = lipo.stdout.trim();
  archOf.set(appPath, arch);
  const want = EXPECTED_ARCH[dirname(appPath).split("/").pop()];
  if (lipo.status !== 0) p(`lipo exited ${lipo.status}`);
  else if (want && arch !== want) p(`lipo -archs is ${arch}, expected ${want}`);

  const sign = run("codesign", ["--verify", "--deep", "--strict", appPath]);
  if (sign.status !== 0) p(`codesign --verify --deep --strict exited ${sign.status}: ${sign.stderr.trim()}`);

  const stack = join(appPath, "Contents/Resources/stack");
  const staged = existsSync(stack)
    ? walk(stack)
        .map((f) => relative(stack, f))
        .sort()
    : [];
  const wantStaged = ["docker-compose.yml", "local/renderer/seccomp.json", "services.lock.json"];
  if (JSON.stringify(staged) !== JSON.stringify(wantStaged))
    p(`Resources/stack holds ${JSON.stringify(staged)}, expected ${JSON.stringify(wantStaged)}`);
  else {
    const composeSha = sha(join(stack, "docker-compose.yml"));
    if (composeSha !== sha(join(REPO, "docker-compose.yml"))) p("Resources/stack/docker-compose.yml differs from the repo root");
    if (sha(join(stack, "local/renderer/seccomp.json")) !== sha(join(REPO, "local/renderer/seccomp.json")))
      p("Resources/stack seccomp.json differs from the repo root");
    const lockBytes = readFileSync(join(stack, "services.lock.json"));
    const lock = JSON.parse(lockBytes.toString("utf8"));
    bundledLocks.set(appPath, lock);
    if (lock.composeSha256 !== composeSha) p("services.lock.json composeSha256 differs from the bundled compose file");
    if (values["local-build"] && lock.kind !== "local") p(`services.lock.json kind is ${lock.kind}, expected local`);
    if (release)
      for (const f of releaseStaticProblems({
        lock,
        lockBytes,
        expectBytes: expectLock,
        version: release,
        composeSha256: composeSha,
        license: { app: readIfBuffer(join(appPath, "Contents/Resources/LICENSE")), repo: repoLicense },
        assertLock: assertReleaseLock,
      }))
        p(f);
    say(`${name}: compose sha256 ${composeSha}\n${name}: seccomp sha256 ${sha(join(stack, "local/renderer/seccomp.json"))}`);
    say(`${name}: services.lock.json kind=${lock.kind ?? "dev"} version=${lock.version} images=${JSON.stringify(lock.images)}`);
  }
  if (!release)
    for (const f of licenseProblems({ app: readIfBuffer(join(appPath, "Contents/Resources/LICENSE")), repo: repoLicense })) p(f);
  const envFiles = walk(appPath).filter((f) => /(^|\/)\.env/.test(relative(appPath, f)));
  if (envFiles.length) p(`contains env files: ${envFiles.map((f) => relative(appPath, f)).join(", ")}`);

  const sizes = { app: du(appPath), asar: statSync(join(appPath, "Contents/Resources/app.asar")).size, dmg: undefined };
  const dmg = dmgFor(arch);
  if (dmg) sizes.dmg = statSync(dmg).size;
  for (const s of sizeProblems(sizes)) p(s);
  say(
    `${name}: arch ${arch}; app ${sizes.app} bytes; app.asar ${sizes.asar} bytes${dmg ? `; ${relative(process.cwd(), dmg)} ${sizes.dmg} bytes` : ""}`,
  );
}

const finish = () => {
  if (problems.length) {
    for (const p of problems) process.stderr.write(`packaged smoke: ${p}\n`);
    process.exit(1);
  }
  say("packaged smoke: ok");
  process.exit(0);
};
if (values.static || problems.length) finish();

const realState = join(homedir(), "Library/Application Support/Open Agent");
const realStateBefore = existsSync(realState) ? String(statSync(realState).mtimeMs) : "absent";
const evidence = values.evidence ? resolve(values.evidence) : undefined;
if (evidence) mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "oab-smoke-"));
const timeoutMs = Number(values.timeout ?? (realDocker ? 900 : 60)) * 1000;

async function createFake(home, scenario = {}) {
  const bin = join(home, "bin");
  mkdirSync(bin, { recursive: true, mode: 0o755 });
  const docker = join(bin, "docker");
  writeFileSync(
    docker,
    `#!${process.execPath}\nimport(${JSON.stringify(join(FAKE_DIR, "docker.mjs"))}).then((m) => m.main(${JSON.stringify(home)}, process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(home, "scenario.json"), JSON.stringify(scenario));
  const sock = createServer();
  await new Promise((res) => sock.listen(join(home, "d.sock"), () => res(undefined)));
  return {
    docker,
    calls: () => readIf(join(home, "calls.jsonl")),
    stop: async () => {
      for (const project of Object.values(readJson(join(home, "state.json"))?.containers ?? {}))
        for (const c of Object.values(project))
          if (c.pid)
            try {
              process.kill(c.pid, "SIGTERM");
            } catch {}
      await new Promise((res) => sock.close(() => res(undefined)));
    },
  };
}

function fakeServicesFile(dir) {
  const file = join(dir, "dev-services.json");
  writeFileSync(
    file,
    JSON.stringify({
      schema: 1,
      kind: "dev",
      version: "0.0.0-fake",
      composeSha256: sha(join(REPO, "docker-compose.yml")),
      images: {
        agent: `127.0.0.1:18467/oab-fake-agent@sha256:${"a".repeat(64)}`,
        search: `127.0.0.1:18467/oab-fake-search@sha256:${"b".repeat(64)}`,
      },
      pull: true,
    }),
  );
  return file;
}

const realEnv = () => ({ PATH: `${dirname(realDocker)}:/usr/bin:/bin`, HOME: process.env.HOME ?? "" });
const realStates = (project) =>
  run(
    realDocker,
    [
      "ps",
      "-a",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--format",
      '{{.Label "com.docker.compose.service"}}={{.State}}',
    ],
    realEnv(),
  )
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
    .sort();

function realTeardown(project, stateDir, port) {
  const stack = join(stateDir, "stack");
  if (existsSync(join(stack, "docker-compose.yml")))
    run(
      realDocker,
      [
        "compose",
        "-p",
        project,
        "-f",
        join(stack, "docker-compose.yml"),
        "--project-directory",
        stack,
        "--env-file",
        "/dev/null",
        "down",
        "-v",
        "--remove-orphans",
      ],
      { ...realEnv(), OPEN_AGENT_DATA_VOLUME: `${project}-data`, OPEN_AGENT_KEYS_VOLUME: `${project}-keys`, OPEN_AGENT_PORT: String(port) },
    );
  run(realDocker, ["volume", "rm", `${project}-data`, `${project}-keys`], realEnv());
}

async function launchOnce(appPath, label, target, fake) {
  const p = (msg) => problems.push(`${label}: ${msg}`);
  const binary = join(appPath, "Contents/MacOS/Open Agent");
  const env = smokeEnv(target, process.env);
  const out = createWriteStream(join(target.stateDir, `${basename(dirname(appPath))}-stdout.log`));
  const callsBefore = fake ? fake.calls() : "";
  const logBefore = readIf(join(target.stateDir, "logs/shell.log"));
  const log = () => readIf(join(target.stateDir, "logs/shell.log")).slice(logBefore.length);
  const started = Date.now();
  const child = spawn(binary, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  let status;
  while (Date.now() - started < timeoutMs && !exited) {
    status = readJson(join(target.stateDir, "status.json"));
    if (status?.screen === "app" && log().includes("[app] app view loaded")) break;
    await sleep(250);
  }
  say(`${label}: pid ${child.pid}; status.json ${JSON.stringify(status)} after ${Date.now() - started} ms`);
  for (const f of statusProblems(status, log(), { localBuild: values["local-build"], release })) p(f);
  if (!log().includes("[app] app view loaded")) p("shell.log has no '[app] app view loaded' line");
  if (status?.port) {
    const health = run("curl", ["-sS", "--max-time", "5", `http://127.0.0.1:${status.port}/health`]);
    say(`${label}: curl /health → exit ${health.status} ${health.stdout.trim()}`);
    if (health.status !== 0) p(`curl /health exited ${health.status}: ${health.stderr.trim()}`);
    else if (release) {
      let got;
      try {
        got = JSON.parse(health.stdout).version;
      } catch {}
      if (got !== release) p(`/health version is ${got}, expected ${release}`);
    }
  }
  for (const line of log()
    .split("\n")
    .filter((l) => /\[app\] (start|title)|\[stack\] (staged|stale|foreign)|\[docker\] (ok|pull)/.test(l)))
    say(`${label}: ${line}`);

  const stopAt = Date.now();
  child.kill("SIGTERM");
  while (!exited && Date.now() - stopAt < 60_000) await sleep(250);
  say(
    `${label}: SIGTERM → ${exited ? `exited after ${Date.now() - stopAt} ms (code ${child.exitCode}, signal ${child.signalCode})` : "still running after 60 s"}`,
  );
  if (!exited) {
    p("did not exit within 60 s of SIGTERM");
    child.kill("SIGKILL");
  }
  if (fake) {
    const calls = fake.calls().slice(callsBefore.length);
    const subs = composeSubcommands(calls);
    say(`${label}: compose subcommands ${subs.join(" ")}`);
    if (!composeStopRecorded(calls)) p("the fake docker recorded no finished compose stop");
    if (release && target.lock) for (const f of pullProblems(calls, target.lock)) p(f);
    return { subs, log: log() };
  }
  const states = realStates(target.project);
  say(`${label}: containers after quit ${states.join(" ")}`);
  if (JSON.stringify(states) !== JSON.stringify(["agent=exited", "renderer=exited", "search=exited"]))
    p(`containers after quit: ${states.join(" ")}`);
  if (!/\[docker\] compose .* stop/.test(log())) p("shell.log has no compose stop after SIGTERM");
  if (release && target.lock) {
    say(`${label}: pulled ${loggedPulls(log()).join(" ") || "nothing (images already present)"}`);
    for (const f of loggedPullProblems(log(), target.lock)) p(f);
  }
  return { subs: [], log: log() };
}

let n = 0;
for (const appPath of apps) {
  n += 1;
  const arch = archOf.get(appPath) ?? "unknown";
  const label = `${relative(process.cwd(), appPath)} (${arch}, ${realDocker ? "real docker" : "fake docker"})`;
  const stateDir = mkdtempSync(join(root, `state-${n}-`));
  const fakeHome = realDocker ? undefined : mkdtempSync(join(root, `fake-${n}-`));
  const lock = bundledLocks.get(appPath);
  const fake = fakeHome
    ? await createFake(fakeHome, release && lock?.images ? { refVersions: refVersionsFor(lock, release) } : {})
    : undefined;
  const target = {
    stateDir,
    project: values.project ?? `oab-smoke-${arch.replace("_", "-")}`,
    range: values.range ?? (realDocker ? "18486-18486" : "18488-18489"),
    docker: realDocker ?? fake.docker,
    ...(values.services ? { services: resolve(values.services) } : fake && !release ? { services: fakeServicesFile(stateDir) } : {}),
  };
  const bad = launchTargetProblems(target, homedir());
  const smokeTarget = release ? { ...target, lock } : target;
  if (bad.length) {
    for (const b of bad) problems.push(`${label}: ${b}`);
    await fake?.stop();
    continue;
  }
  try {
    await launchOnce(appPath, label, smokeTarget, fake);
    if (values.moved && fake) {
      const movedDir = mkdtempSync(join(root, "moved-"));
      const moved = join(movedDir, "Open Agent.app");
      const copy = run("ditto", [appPath, moved]);
      if (copy.status !== 0) problems.push(`${label}: ditto exited ${copy.status}`);
      else {
        const second = await launchOnce(moved, `${label} moved to ${movedDir}`, target, fake);
        if (second.subs.includes("up")) problems.push(`${label}: the moved app ran compose up (expected start only)`);
        if (/\[stack\] (foreign|stale)/.test(second.log)) problems.push(`${label}: the moved app did not see the stack as ours`);
        if (!second.subs.includes("start")) problems.push(`${label}: the moved app did not compose start the stopped stack`);
        rmSync(movedDir, { recursive: true, force: true });
      }
    }
  } finally {
    if (evidence) {
      const tag = `${n}-${arch}${realDocker ? "-real" : "-fake"}`;
      for (const [from, to] of [
        ["logs/shell.log", `shell-${tag}.log`],
        ["status.json", `status-${tag}.json`],
      ])
        if (existsSync(join(stateDir, from))) copyFileSync(join(stateDir, from), join(evidence, to));
      if (fake && existsSync(join(fakeHome, "calls.jsonl")))
        copyFileSync(join(fakeHome, "calls.jsonl"), join(evidence, `calls-${tag}.jsonl`));
    }
    if (realDocker) realTeardown(target.project, stateDir, Number(target.range.split("-")[0]));
    await fake?.stop();
  }
}

const realStateAfter = existsSync(realState) ? String(statSync(realState).mtimeMs) : "absent";
say(`real ~/Library/Application Support/Open Agent: before ${realStateBefore}, after ${realStateAfter}`);
if (realStateBefore !== realStateAfter) problems.push("the real ~/Library/Application Support/Open Agent changed");
rmSync(root, { recursive: true, force: true });
finish();
