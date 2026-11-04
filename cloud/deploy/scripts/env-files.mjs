#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const KNOWN = [
  ".env-agent",
  ".env-renderer",
  ".env-nextjs",
  ".env-caddy",
  ".env-llm",
  ".env-search",
  "env-files/.env-supabase-admin",
  "env-files/.env-e2e",
];

const USAGE = "usage: env-files.mjs --from <…/deploy-config|…/cloud/deploy> --to <…/cloud/deploy> (--copy | --move) [--dry-run]";
const octal = (mode) => `0${(mode & 0o777).toString(8).padStart(3, "0")}`;
const endsWith = (path, ...segments) => path.split(sep).slice(-segments.length).join("/") === segments.join("/");

class Refusal extends Error {}

const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};

export function dirProblem(label, st, uid, target) {
  if (st.isSymbolicLink()) return `${label} is a symlink`;
  if (!st.isDirectory()) return `${label} is not a directory`;
  if (st.uid !== uid) return `${label} is not owned by uid ${uid}`;
  if (target && (st.mode & 0o022) !== 0) return `${label} is group- or world-writable`;
  return undefined;
}

function checkDir(label, path, uid, target) {
  const st = lstatOrNull(path);
  if (!st) return false;
  const problem = dirProblem(label, st, uid, target);
  if (problem) throw new Refusal(problem);
  return true;
}

function readSource(path, name) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    if (e.code === "ELOOP") throw new Refusal(`${name} is a symlink`);
    throw new Refusal(`${name} cannot be opened (${e.code})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Refusal(`${name} is not a regular file`);
    if (st.nlink !== 1) throw new Refusal(`${name} has ${st.nlink} links`);
    return { mode: st.mode & 0o777, bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

function sameFileBytes(path, want) {
  try {
    const again = readSource(path, basename(path));
    return again?.bytes.equals(want) === true;
  } catch (e) {
    if (e instanceof Refusal) return false;
    throw e;
  }
}

function unknownFiles(from) {
  const out = [];
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, d.name);
      if (d.isDirectory()) walk(path);
      else if (d.name.startsWith(".env")) {
        const rel = relative(from, path).split(sep).join("/");
        if (!KNOWN.includes(rel)) out.push(rel);
      }
    }
  };
  walk(from);
  return out.sort();
}

function preflight({ from, to }, uid) {
  if (!endsWith(to, "cloud", "deploy")) throw new Refusal("--to must end in cloud/deploy");
  if (!endsWith(from, "deploy-config") && !endsWith(from, "cloud", "deploy"))
    throw new Refusal("--from must end in deploy-config or cloud/deploy");
  if (from === to) throw new Refusal("--from and --to are the same folder");
  if (!checkDir("--to", to, uid, true)) throw new Refusal("--to does not exist");
  if (realpathSync(to) !== to) throw new Refusal("--to is reached through a symlink");
  const fromStat = lstatOrNull(from);
  if (!fromStat?.isDirectory()) throw new Refusal("--from is not a directory");
  if (realpathSync(from) === to) throw new Refusal("--from and --to are the same folder");
  const top = spawnSync("git", ["-C", to, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) throw new Refusal("--to is not inside a git work tree");
  const root = realpathSync(top.stdout.trim());
  if (!`${to}${sep}`.startsWith(`${root}${sep}`) || to === root) throw new Refusal("--to is outside its git top level");
  checkDir("--from env-files", join(from, "env-files"), uid, false);
  const targetEnvFiles = checkDir("--to env-files", join(to, "env-files"), uid, true);
  for (const name of KNOWN) {
    const r = spawnSync("git", ["-C", to, "check-ignore", "-q", "--", join(to, name)]);
    if (r.status !== 0) throw new Refusal(`${name} in --to is not git-ignored`);
  }
  const sources = KNOWN.map((name) => ({ name, src: readSource(join(from, name), name) }));
  return { sources, targetEnvFiles };
}

export function run(
  { from: fromArg, to: toArg, action, dryRun },
  { log = console.log, write = writeFileSync, uid = process.getuid() } = {},
) {
  const from = resolve(fromArg);
  const to = resolve(toArg);
  let plan;
  try {
    plan = preflight({ from, to }, uid);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    log(`env-files: refused: ${e.message}`);
    return 1;
  }
  let refused = false;
  let envFilesReady = plan.targetEnvFiles;
  for (const { name, src } of plan.sources) {
    if (!src) {
      log(`${name} - - absent`);
      continue;
    }
    const head = `${name} ${octal(src.mode)} ${src.bytes.length}`;
    const dst = join(to, name);
    if (lstatOrNull(dst)) {
      log(`${head} exists-skip`);
      refused = true;
      continue;
    }
    const mode = src.mode & 0o600;
    const note = mode !== src.mode ? ` (target ${octal(mode)}, tightened)` : "";
    if (dryRun) {
      log(`${head} ${action} (dry run)${note}`);
      continue;
    }
    if (name.startsWith("env-files/") && !envFilesReady) {
      mkdirSync(join(to, "env-files"), { mode: 0o700 });
      const problem = dirProblem("--to env-files", lstatSync(join(to, "env-files")), uid, true);
      if (problem) {
        log(`env-files: refused: ${problem}`);
        return 1;
      }
      envFilesReady = true;
    }
    const fd = openSync(dst, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try {
      write(fd, src.bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (action === "move") {
      if (!sameFileBytes(dst, src.bytes) || !sameFileBytes(join(from, name), src.bytes)) {
        log(`env-files: refused: ${name} differs from its source after writing; source kept`);
        refused = true;
        continue;
      }
      unlinkSync(join(from, name));
    }
    log(`${head} ${action}${note}`);
  }
  const unknown = unknownFiles(from);
  for (const rel of unknown) log(`${rel} unknown (not moved)`);
  if (refused) return 1;
  return unknown.length ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        from: { type: "string" },
        to: { type: "string" },
        copy: { type: "boolean", default: false },
        move: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      },
    }));
  } catch {
    console.log(`env-files: refused: ${USAGE}`);
    process.exit(1);
  }
  if (!values.from || !values.to) {
    console.log(`env-files: refused: ${USAGE}`);
    process.exit(1);
  }
  if (values.copy === values.move) {
    console.log("env-files: refused: give exactly one of --copy and --move");
    process.exit(1);
  }
  process.exitCode = run({
    from: values.from,
    to: values.to,
    action: values.copy ? "copy" : "move",
    dryRun: values["dry-run"],
  });
}
