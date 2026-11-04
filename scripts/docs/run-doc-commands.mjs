#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMain, main } from "../release/cli.mjs";
import { LOCAL_REGISTRY_REF } from "../release/releaseLib.mjs";
import {
  COVERED_FILES,
  classify,
  coverage,
  extractCommands,
  forbiddenNames,
  guideVersion,
  loadManifest,
  manifestProblems,
  PREFLIGHT_ARGS,
  REPO,
  substitute,
  substitutionRules,
  tsvRow,
} from "./doc-commands.mjs";

export const SCRATCH = Object.freeze({
  project: "oab-factory-m5-clone",
  port: 18520,
  dataVolume: "oab-factory-m5-clone-data",
  keysVolume: "oab-factory-m5-clone-keys",
  path: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  branch: "revamp/integration",
});
export const DESKTOP_PLUGINS = "/Applications/Docker.app/Contents/Resources/cli-plugins";
export const PLUGIN_DIRS = Object.freeze([
  "/opt/homebrew/lib/docker/cli-plugins",
  "/usr/local/lib/docker/cli-plugins",
  "/usr/libexec/docker/cli-plugins",
  "/usr/lib/docker/cli-plugins",
]);
const TRUSTED_PLUGINS = ["docker-compose", "docker-buildx"];
const LOCAL_TAGS = ["open-agent:local", "open-agent-search:local"];
const TSV_HEADER = ["source", "command (as documented)", "mode", "command as run", "exit", "note"];
const RUN_TIMEOUT_MS = 60 * 60 * 1000;
export const RUN_SHELL = Object.freeze(["--noprofile", "--norc", "-f", "+B", "-c"]);

export function scratchEnv({ dir, realHome = homedir(), exists = existsSync }) {
  const sock = join(realHome, ".docker/run/docker.sock");
  return {
    HOME: join(dir, "home"),
    PATH: SCRATCH.path,
    LANG: "en_US.UTF-8",
    DOCKER_CONFIG: join(dir, "docker-config"),
    DOCKER_HOST: `unix://${exists(sock) ? sock : "/var/run/docker.sock"}`,
    COMPOSE_PROJECT_NAME: SCRATCH.project,
    OPEN_AGENT_PORT: String(SCRATCH.port),
    OPEN_AGENT_DATA_VOLUME: SCRATCH.dataVolume,
    OPEN_AGENT_KEYS_VOLUME: SCRATCH.keysVolume,
  };
}

export function writeDockerConfig({ dir, desktopPlugins = DESKTOP_PLUGINS, pluginDirs = PLUGIN_DIRS }) {
  const cfgDir = join(dir, "docker-config");
  mkdirSync(cfgDir, { recursive: true, mode: 0o700 });
  const desktop = existsSync(desktopPlugins);
  writeFileSync(join(cfgDir, "config.json"), `${JSON.stringify({ cliPluginsExtraDirs: desktop ? [desktopPlugins] : [] })}\n`);
  if (desktop) return { config: join(cfgDir, "config.json"), links: [] };
  const links = [];
  mkdirSync(join(cfgDir, "cli-plugins"), { recursive: true });
  for (const p of TRUSTED_PLUGINS) {
    const from = pluginDirs.map((d) => join(d, p)).find((f) => existsSync(f));
    if (!from) continue;
    symlinkSync(from, join(cfgDir, "cli-plugins", p));
    links.push(from);
  }
  return { config: join(cfgDir, "config.json"), links };
}

export function preflight(cwd, env, exec, project, port, args = PREFLIGHT_ARGS) {
  const cfg = exec("docker", [...args], { cwd, env });
  if (cfg.status !== 0) return { ok: false, reason: `docker ${args.join(" ")} exited ${cfg.status}: ${cfg.stderr.trim()}` };
  const jq = exec("jq", ["-r", ".name"], { cwd, env, input: cfg.stdout });
  const name = jq.stdout.trim();
  if (jq.status !== 0 || name !== project) return { ok: false, reason: `project is '${name}', expected '${project}'` };
  const parsed = JSON.parse(cfg.stdout);
  if (port !== undefined)
    for (const [svc, s] of Object.entries(parsed.services ?? {}))
      for (const p of s.ports ?? [])
        if (p.host_ip !== "127.0.0.1" || String(p.published) !== String(port))
          return {
            ok: false,
            reason: `${svc} publishes ${p.host_ip ?? "0.0.0.0"}:${p.published}, not 127.0.0.1:${port} (port ${p.published})`,
          };
  for (const v of Object.values(parsed.volumes ?? {}))
    if (!String(v.name ?? "").startsWith("oab-")) return { ok: false, reason: `volume ${v.name} does not start with oab-` };
  return { ok: true, name };
}

const realOrParent = (p) => {
  let cur = resolve(p);
  const tail = [];
  while (!existsSync(cur)) {
    tail.unshift(cur.split("/").pop());
    cur = dirname(cur);
  }
  return join(realpathSync(cur), ...tail);
};
const within = (p, root) => p === root || p.startsWith(`${root}/`);

export function parseRunnerArgs(argv, { tmp = realpathSync(tmpdir()), repo = REPO } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      scratch: { type: "string" },
      "release-dir": { type: "string" },
      log: { type: "string" },
      tsv: { type: "string" },
      branch: { type: "string", default: SCRATCH.branch },
    },
  });
  if (!values.scratch) throw new Error("pass --scratch <empty dir>");
  const scratch = realOrParent(values.scratch);
  const roots = [tmp, join(realpathSync(repo), ".factory")];
  if (!roots.some((r) => within(scratch, r) && scratch !== r))
    throw new Error(`--scratch must be under ${roots.join(" or ")}, got ${values.scratch}`);
  if (existsSync(scratch) && readdirSync(scratch).length) throw new Error(`--scratch ${values.scratch} is not empty`);
  for (const k of ["release-dir", "log", "tsv"]) if (!values[k]) throw new Error(`pass --${k}`);
  const releaseDir = resolve(values["release-dir"]);
  for (const f of ["lock/services.lock.json", "release/SHA256SUMS"])
    if (!existsSync(join(releaseDir, f))) throw new Error(`--release-dir ${values["release-dir"]} has no ${f}`);
  return { scratch, releaseDir, log: resolve(values.log), tsv: resolve(values.tsv), branch: values.branch };
}

export function fileContext(base, file) {
  const work = join(base.dir, "work", basename(file).replace(/\.md$/, ""));
  return { ...base, work, clone: join(work, "open-agent-bot") };
}

export function teardownClone(ctx, env, exec, log, hasCompose = (d) => existsSync(join(d, "docker-compose.yml"))) {
  if (!hasCompose(ctx.clone)) return;
  const pf = preflight(ctx.clone, env, exec, ctx.project, ctx.port);
  if (!pf.ok) {
    log(`[runner] teardown of ${ctx.clone} skipped: preflight ${pf.reason}\n`);
    return;
  }
  const r = exec("docker", ["compose", "down", "-v", "--remove-orphans"], { cwd: ctx.clone, env });
  log(`[runner] teardown ${ctx.clone} docker compose down -v --remove-orphans (${ctx.project}): exit ${r.status}\n${r.stderr ?? ""}`);
}

export function createRunner({
  ctx,
  env,
  manifest,
  exec,
  log,
  hasCompose = (d) => existsSync(join(d, "docker-compose.yml")),
  preflightDir,
}) {
  const rules = substitutionRules(ctx);
  const byKey = new Map((manifest.commands ?? []).map((e) => [`${e.file}\0${e.command}`, e]));
  const runner = {
    cwd: ctx.work ?? ctx.dir,
    rows: [],
    run(occ) {
      const source = `${occ.file}:${occ.line}`;
      const e = byKey.get(`${occ.file}\0${occ.command}`);
      log(`=== ${source} [${e?.mode ?? "unlisted"}]\n`);
      const row = (mode, asRun, exit, note, ok) => {
        const r = { source, documented: occ.command, mode, asRun, exit, note, ok };
        runner.rows.push(r);
        log(`result: ${ok ? "ok" : "FAILED"}${note ? ` (${note})` : ""}\n\n`);
        return r;
      };
      if (!e) return row("", "", "refused", "not listed in doc-commands.json", false);
      if (e.mode === "owner") {
        log(`documented: ${occ.command}\nowner: ${e.reason}\n`);
        return row("owner", "", "", e.reason, true);
      }
      const sub = substitute(occ.command, e.subst ?? [], rules);
      if (sub.missing.length) return row(e.mode, "", "refused", `substitution did not apply: ${sub.missing.join(", ")}`, false);
      const bad = forbiddenNames(sub.text, ctx);
      if (bad) {
        log(`documented: ${occ.command}\nrefused: ${bad}\n`);
        return row(e.mode, sub.text, "refused", `refused: ${bad}`, false);
      }
      const cwd = e.cwd === "downloads" ? ctx.downloads : runner.cwd;
      const c = classify(sub.text, ctx, cwd);
      if (!c.runnable) {
        log(`documented: ${occ.command}\nowner (forced): ${c.reason}\n`);
        return row("owner", "", "", `${c.reason} (declared ${e.mode})`, true);
      }
      for (const d of c.docker) {
        const at = (d.preflight ?? hasCompose(d.cwd)) ? d.cwd : preflightDir;
        const pf = preflight(at, env, exec, ctx.project, ctx.port, d.preflight);
        log(`preflight (${at}): ${pf.ok ? `ok ${pf.name}` : pf.reason}\n`);
        if (!pf.ok) return row(e.mode, c.asRun, "refused", `preflight: ${pf.reason}`, false);
      }
      log(`documented: ${occ.command}\nas run:     ${c.asRun}\ncwd:        ${cwd}\nenv:        scratch base (no changes)\n`);
      const r = exec("/bin/bash", [...RUN_SHELL, c.asRun], { cwd, env, timeout: RUN_TIMEOUT_MS });
      log(`--- stdout\n${r.stdout}--- stderr\n${r.stderr}exit: ${r.status}\n`);
      const want = e.expectExit ?? 0;
      const ok = r.status === want;
      if (ok && e.cwd !== "downloads") runner.cwd = c.cwdAfter;
      const note =
        e.expectExit !== undefined
          ? `expected exit ${e.expectExit}: ${e.reason}`
          : sub.applied.length
            ? `subst: ${sub.applied.join(", ")}`
            : "";
      return row(e.mode, c.asRun, r.status, note, ok);
    },
  };
  return runner;
}

const spawnExec = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...o });
  return { status: r.error ? 127 : r.status, stdout: r.stdout ?? "", stderr: r.error ? r.error.message : (r.stderr ?? "") };
};

function must(r, what) {
  if (r.status !== 0) throw new Error(`${what} exited ${r.status}: ${r.stderr.trim()}`);
  return r;
}

function prepareInstall(dir, releaseDir, log) {
  const app = join(dir, "install", "Open Agent.app");
  mkdirSync(join(dir, "install"), { recursive: true });
  const dmg = readdirSync(join(releaseDir, "release")).find((f) => /^Open-Agent-.+-arm64\.dmg$/.test(f));
  if (!dmg) {
    mkdirSync(app);
    log(`install: no arm64 DMG in ${releaseDir}/release; using an empty stand-in folder\n`);
  } else {
    const mnt = join(dir, ".mnt");
    mkdirSync(mnt);
    must(
      spawnExec("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mnt, join(releaseDir, "release", dmg)]),
      "hdiutil attach",
    );
    try {
      must(spawnExec("ditto", [join(mnt, "Open Agent.app"), app]), "ditto");
    } finally {
      must(spawnExec("hdiutil", ["detach", mnt]), "hdiutil detach");
    }
    log(`install: copied Open Agent.app from ${dmg} to ${app}\n`);
  }
  const q = `0083;${Math.floor(Date.now() / 1000).toString(16)};Safari;`;
  must(spawnExec("xattr", ["-w", "com.apple.quarantine", q, app]), "xattr -w");
  log(`install: quarantined (${q})\n`);
  return app;
}

function localImages(env) {
  const out = {};
  for (const t of LOCAL_TAGS) {
    const r = spawnExec("docker", ["image", "inspect", t, "--format", "{{.Id}}"], { env });
    if (r.status === 0) out[t] = r.stdout.trim();
  }
  return out;
}

function restoreLocalImages(before, env, log) {
  const after = localImages(env);
  for (const t of LOCAL_TAGS) {
    if (!after[t] || after[t] === before[t]) continue;
    if (before[t]) must(spawnExec("docker", ["tag", before[t], t], { env }), `docker tag ${t}`);
    const r = spawnExec("docker", ["image", "rm", before[t] ? after[t] : t], { env });
    log(
      `teardown: ${before[t] ? `restored ${t} to ${before[t]}, removed ${after[t]}` : `removed ${t} built by this run`} (exit ${r.status})\n`,
    );
  }
}

export function runDocCommands(argv) {
  const o = parseRunnerArgs(argv);
  mkdirSync(o.scratch, { recursive: true });
  const dir = realpathSync(o.scratch);
  mkdirSync(dirname(o.log), { recursive: true });
  mkdirSync(dirname(o.tsv), { recursive: true });
  writeFileSync(o.log, "");
  const log = (s) => {
    appendFileSync(o.log, s);
    process.stdout.write(s);
  };
  const lock = JSON.parse(readFileSync(join(o.releaseDir, "lock/services.lock.json"), "utf8"));
  for (const k of ["agent", "search"])
    if (!LOCAL_REGISTRY_REF.test(lock.images?.[k] ?? ""))
      throw new Error(`the dry-run lock's ${k} ref is not a local-registry ref: ${lock.images?.[k]}`);
  const dmgName = readdirSync(join(o.releaseDir, "release")).find((f) => /^Open-Agent-.+-arm64\.dmg$/.test(f));
  const install = readFileSync(join(REPO, "docs/INSTALL.md"), "utf8");
  const base = {
    repo: REPO,
    dir,
    downloads: join(dir, "downloads"),
    installApp: join(dir, "install", "Open Agent.app"),
    port: SCRATCH.port,
    branch: o.branch,
    project: SCRATCH.project,
    guideVersion: guideVersion(install),
    dryVersion: dmgName ? /^Open-Agent-(.+)-arm64\.dmg$/.exec(dmgName)[1] : lock.version,
    refs: lock.images,
  };
  const manifest = loadManifest();
  const extracted = COVERED_FILES.flatMap((f) => extractCommands(readFileSync(join(REPO, f), "utf8"), f));
  const cov = coverage(extracted, manifest, COVERED_FILES);
  const problems = [
    ...manifestProblems(manifest, Object.keys(substitutionRules(base))),
    ...cov.missing.map((m) => `missing: ${m}`),
    ...cov.extra.map((m) => `extra: ${m}`),
  ];
  if (problems.length) throw new Error(`doc-commands.json: ${problems.join("; ")}`);

  mkdirSync(join(dir, "home"), { mode: 0o700 });
  const docker = writeDockerConfig({ dir });
  const env = scratchEnv({ dir });
  log(`[runner] scratch ${dir}\n[runner] repo ${REPO} branch ${o.branch}\n[runner] env ${JSON.stringify(env)}\n`);
  log(
    `[runner] docker config ${readFileSync(docker.config, "utf8").trim()}${docker.links.length ? ` plugins ${docker.links.join(", ")}` : ""}\n`,
  );
  for (const args of [
    ["compose", "version"],
    ["buildx", "version"],
  ]) {
    const r = spawnExec("docker", args, { cwd: dir, env });
    log(`[runner] self-check docker ${args.join(" ")}: exit ${r.status} ${r.stdout.trim()}${r.stderr.trim()}\n`);
    if (r.status !== 0)
      throw new Error(`self-check docker ${args.join(" ")} failed in the scratch environment (exit ${r.status}): ${r.stderr.trim()}`);
  }
  mkdirSync(base.downloads);
  for (const f of readdirSync(join(o.releaseDir, "release"))) copyFileSync(join(o.releaseDir, "release", f), join(base.downloads, f));
  log(`[runner] downloads: ${readdirSync(base.downloads).join(", ")}\n`);
  prepareInstall(dir, o.releaseDir, log);
  const preflightDir = join(dir, ".preflight");
  mkdirSync(preflightDir);
  const compose = must(spawnExec("git", ["-C", REPO, "show", `${o.branch}:docker-compose.yml`]), "git show docker-compose.yml");
  writeFileSync(join(preflightDir, "docker-compose.yml"), compose.stdout);
  const imagesBefore = localImages(env);
  log(`[runner] local tags before: ${JSON.stringify(imagesBefore)}\n`);

  const rows = [];
  try {
    for (const file of COVERED_FILES) {
      const ctx = fileContext(base, file);
      mkdirSync(ctx.work, { recursive: true });
      log(`[runner] ${file}: workspace ${ctx.work}\n`);
      const runner = createRunner({ ctx, env, manifest, exec: spawnExec, log, preflightDir });
      try {
        for (const occ of extracted.filter((c) => c.file === file)) runner.run(occ);
      } finally {
        rows.push(...runner.rows);
        teardownClone(ctx, env, spawnExec, log);
      }
    }
  } finally {
    restoreLocalImages(imagesBefore, env, log);
    writeFileSync(
      o.tsv,
      `${[tsvRow(TSV_HEADER), ...rows.map((r) => tsvRow([r.source, r.documented, r.mode, r.asRun, r.exit, r.note]))].join("\n")}\n`,
    );
  }
  const failed = rows.filter((r) => !r.ok);
  const count = (m) => rows.filter((r) => r.mode === m).length;
  log(
    `[runner] ${rows.length} commands: run ${count("run")}, env ${count("env")}, subst ${count("subst")}, owner ${count("owner")}; failed ${failed.length}\n`,
  );
  for (const f of failed) log(`[runner] FAILED ${f.source} exit ${f.exit}: ${f.documented} ${f.note}\n`);
  return failed.length ? 1 : 0;
}

if (isMain(import.meta.url)) main("run-doc-commands", () => runDocCommands(process.argv.slice(2)));
