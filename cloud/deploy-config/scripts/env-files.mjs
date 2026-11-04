#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { join, relative, resolve, sep } from "node:path";
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

export const GROUPS = {
  backend: [".env-agent", ".env-renderer", ".env-caddy", ".env-llm", ".env-search"],
  frontend: [".env-nextjs"],
  ops: ["env-files/.env-supabase-admin", "env-files/.env-e2e"],
};

export const TARGETS = Object.keys(GROUPS).map((g) => `${g}/.env`);

export const MAX_BYTES = 64 * 1024;

const USAGE =
  "usage: env-files.mjs --from <…/deploy-config|…/cloud/deploy> --to <…/cloud/deploy-config/env-files> (--copy | --move) [--dry-run]";
const LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
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

const splitLines = (bytes) => {
  const lines = bytes.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

export function parseEnv(bytes, name) {
  const entries = [];
  const seen = new Map();
  splitLines(bytes).forEach((raw, index) => {
    const trimmed = raw.replace(/\r$/, "").trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const m = LINE.exec(trimmed);
    if (!m) throw new Refusal(`${name} line ${index + 1} is not KEY=VALUE`);
    const [, key, value] = m;
    if (seen.has(key) && seen.get(key) !== value) throw new Refusal(`${name} sets ${key} twice with different values`);
    seen.set(key, value);
    entries.push({ key, value, index });
  });
  return entries;
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
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    if (e.code === "ELOOP") throw new Refusal(`${name} is a symlink`);
    throw new Refusal(`${name} cannot be opened (${e.code})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Refusal(`${name} is not a regular file`);
    if (st.nlink !== 1) throw new Refusal(`${name} has ${st.nlink} links`);
    if (st.size > MAX_BYTES) throw new Refusal(`${name} is larger than ${MAX_BYTES} bytes`);
    return { mode: st.mode & 0o777, bytes: readFileSync(fd) };
  } finally {
    closeSync(fd);
  }
}

function sameFileBytes(path, name, want) {
  try {
    return readSource(path, name)?.bytes.equals(want) === true;
  } catch (e) {
    if (e instanceof Refusal) return false;
    throw e;
  }
}

function readsBack(path, name, want) {
  try {
    const got = readSource(path, name);
    if (!got) return false;
    const map = new Map(parseEnv(got.bytes, name).map((e) => [e.key, e.value]));
    return map.size === want.size && [...want].every(([k, v]) => map.get(k) === v);
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

function merge(group, sources, log) {
  const values = new Map();
  const owner = new Map();
  const out = [];
  let mode = 0o600;
  let tightened;
  const used = sources.filter((s) => s.src);
  for (const { name, src, entries } of used) {
    mode &= src.mode;
    if ((src.mode & 0o600) !== src.mode && tightened === undefined) tightened = src.mode;
    const drop = new Set();
    for (const e of entries) {
      if (!values.has(e.key)) {
        values.set(e.key, e.value);
        owner.set(e.key, name);
        continue;
      }
      if (values.get(e.key) !== e.value) throw new Refusal(`${e.key} differs between ${owner.get(e.key)} and ${name}`);
      drop.add(e.index);
      if (owner.get(e.key) !== name) log(`${e.key} in ${name} is the same as in ${owner.get(e.key)} (kept once)`);
    }
    out.push(...splitLines(src.bytes).filter((_, i) => !drop.has(i)));
  }
  const bytes = Buffer.from(out.length ? `${out.join("\n")}\n` : "");
  return { group, used, values, bytes, mode: mode & 0o600, tightened };
}

function preflight({ from, to }, uid, log) {
  if (!endsWith(to, "cloud", "deploy-config", "env-files")) throw new Refusal("--to must end in cloud/deploy-config/env-files");
  if (endsWith(from, "cloud", "deploy-config")) throw new Refusal("--from is the new layout; give the old deploy-config or cloud/deploy");
  if (!endsWith(from, "deploy-config") && !endsWith(from, "cloud", "deploy"))
    throw new Refusal("--from must end in deploy-config or cloud/deploy");
  if (!checkDir("--to", to, uid, true)) throw new Refusal("--to does not exist");
  if (realpathSync(to) !== to) throw new Refusal("--to is reached through a symlink");
  const fromStat = lstatOrNull(from);
  if (!fromStat?.isDirectory()) throw new Refusal("--from is not a directory");
  const realFrom = realpathSync(from);
  if (realFrom === to || realFrom.startsWith(`${to}${sep}`)) throw new Refusal("--from is inside --to");
  const top = spawnSync("git", ["-C", to, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (top.status !== 0) throw new Refusal("--to is not inside a git work tree");
  const root = realpathSync(top.stdout.trim());
  if (!`${to}${sep}`.startsWith(`${root}${sep}`) || to === root) throw new Refusal("--to is outside its git top level");
  checkDir("--from env-files", join(from, "env-files"), uid, false);
  const ready = {};
  for (const group of Object.keys(GROUPS)) ready[group] = checkDir(`--to ${group}`, join(to, group), uid, true);
  for (const target of TARGETS) {
    const r = spawnSync("git", ["-C", to, "check-ignore", "-q", "--", join(to, target)]);
    if (r.status !== 0) throw new Refusal(`${target} in --to is not git-ignored`);
  }
  const plans = Object.entries(GROUPS).map(([group, names]) => {
    const sources = names.map((name) => {
      const src = readSource(join(from, name), name);
      return { name, src, entries: src ? parseEnv(src.bytes, name) : [] };
    });
    return merge(group, sources, log);
  });
  return { plans, ready };
}

function ensureGroupDir(to, group, uid, mkdir) {
  try {
    mkdir(join(to, group), { mode: 0o700 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  return dirProblem(`--to ${group}`, lstatSync(join(to, group)), uid, true);
}

export function run(
  { from: fromArg, to: toArg, action, dryRun },
  { log = console.log, write = writeFileSync, mkdir = mkdirSync, uid = process.getuid() } = {},
) {
  const from = resolve(fromArg);
  const to = resolve(toArg);
  const notes = [];
  let plan;
  try {
    plan = preflight({ from, to }, uid, (l) => notes.push(l));
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    log(`env-files: refused: ${e.message}`);
    return 1;
  }
  for (const p of plan.plans)
    for (const name of GROUPS[p.group]) {
      const s = p.used.find((u) => u.name === name);
      log(s ? `${name} ${octal(s.src.mode)} ${s.src.bytes.length} -> ${p.group}/.env` : `${name} - - absent`);
    }
  for (const l of notes) log(l);
  let refused = false;
  for (const p of plan.plans) {
    const target = `${p.group}/.env`;
    if (!p.used.length) {
      log(`${target} - - no sources`);
      continue;
    }
    const dst = join(to, target);
    if (lstatOrNull(dst)) {
      log(`${target} exists-skip`);
      refused = true;
      continue;
    }
    const head = `${target} ${octal(p.mode)} ${p.bytes.length}`;
    const note = p.tightened === undefined ? "" : ` (from ${octal(p.tightened)}, tightened)`;
    const keys = ` keys ${[...p.values.keys()].join(" ")}`;
    if (dryRun) {
      log(`${head} ${action} (dry run)${note}${keys}`);
      continue;
    }
    if (!plan.ready[p.group]) {
      const problem = ensureGroupDir(to, p.group, uid, mkdir);
      if (problem) {
        log(`env-files: refused: ${problem}`);
        return 1;
      }
      plan.ready[p.group] = true;
    } else if ((lstatSync(join(to, p.group)).mode & 0o777) !== 0o700) {
      chmodSync(join(to, p.group), 0o700);
      log(`--to ${p.group} tightened to 0700`);
    }
    const fd = openSync(dst, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, p.mode);
    try {
      write(fd, p.bytes);
      fsyncSync(fd);
    } catch (e) {
      closeSync(fd);
      unlinkSync(dst);
      log(`env-files: refused: ${target} could not be written (${e.code ?? e.name}); nothing left behind`);
      return 1;
    }
    closeSync(fd);
    if (!readsBack(dst, target, p.values)) {
      log(`env-files: refused: ${target} does not read back the same keys and values; sources kept`);
      refused = true;
      continue;
    }
    if (action === "move") {
      const changed = p.used.filter((s) => !sameFileBytes(join(from, s.name), s.name, s.src.bytes));
      if (changed.length) {
        log(`env-files: refused: ${changed.map((s) => s.name).join(", ")} changed while copying; sources kept`);
        refused = true;
        continue;
      }
      for (const s of p.used) unlinkSync(join(from, s.name));
    }
    log(`${head} ${action}${note}${keys}`);
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
