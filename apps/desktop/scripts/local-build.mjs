#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dockerBuilds, hostArchFlag, localLock, localRefs, localVersion, parseLocalBuildArgs } from "./localBuildLib.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");
const say = (m) => process.stdout.write(`local-build: ${m}\n`);
const fail = (m) => {
  process.stderr.write(`local-build: ${m}\n`);
  process.exit(1);
};

const parsed = parseLocalBuildArgs(process.argv.slice(2), process.env);
if (!parsed.ok) fail(parsed.reason);
const { prefix, lockOut, dist, docker = "docker" } = parsed.opts;

const run = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...o });
  if (r.error) fail(`${cmd} ${args.join(" ")}: ${r.error.message}`);
  return r;
};
const must = (cmd, args, o = {}) => {
  const r = run(cmd, args, o);
  if (r.status !== 0)
    fail(`${cmd} ${args.join(" ")} exited ${r.status}${r.stderr ? `: ${r.stderr.trim().split("\n").slice(-5).join("\n")}` : ""}`);
  return r;
};

const sha = must("git", ["rev-parse", "--short", "HEAD"]).stdout.trim();
const dirty = must("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim() !== "";
const version = localVersion(sha, dirty);
const refs = localRefs(prefix);
say(`version ${version}${dirty ? " (tracked files have uncommitted changes)" : ""}; images ${refs.agent}, ${refs.search}`);

for (const args of dockerBuilds(refs, version)) {
  say(`${docker} ${args.join(" ")}`);
  must(docker, args, { stdio: ["ignore", "inherit", "inherit"] });
}

const idOf = (ref) => must(docker, ["image", "inspect", "-f", "{{.Id}}", ref]).stdout.trim();
const ids = { agent: idOf(refs.agent), search: idOf(refs.search) };
const composeSha256 = createHash("sha256")
  .update(readFileSync(join(REPO, "docker-compose.yml")))
  .digest("hex");
const lock = localLock({ version, composeSha256, refs, ids });
const lockPath = lockOut ?? join(APP, "build/services.local.lock.json");
mkdirSync(dirname(lockPath), { recursive: true });
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
say(`wrote ${lockPath} (agent ${ids.agent.slice(0, 19)}…, search ${ids.search.slice(0, 19)}…)`);
if (!dist) {
  say("--no-dist: stopping after the lock");
  process.exit(0);
}

const node = process.execPath;
must(node, [join(APP, "scripts/stage-stack.mjs"), "--lock", lockPath], { stdio: "inherit" });
must(node, [join(APP, "scripts/build.mjs")], { stdio: "inherit" });
const arch = hostArchFlag(process.arch);
const builder = join(REPO, "node_modules/.bin/electron-builder");
const built = run(builder, ["--mac", arch, "--publish", "never"], {
  cwd: APP,
  stdio: "inherit",
  env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
});
must(node, [join(APP, "scripts/stage-stack.mjs")], { stdio: "inherit" });
if (built.status !== 0) fail(`electron-builder exited ${built.status}`);
const appVersion = JSON.parse(readFileSync(join(APP, "package.json"), "utf8")).version;
say(
  `done: apps/desktop/release/Open-Agent-${appVersion}-${arch.slice(2)}.dmg (Local build ${version}); build/stack is back on the committed lock`,
);
