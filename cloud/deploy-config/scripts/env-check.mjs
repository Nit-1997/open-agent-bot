#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseEnv } from "./env-files.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const DEFAULT_DIR = join(ROOT, "cloud/deploy-config/env-files");
const COMPOSE = join(ROOT, "cloud/deploy/compose.hosted.yml");

export const REQUIRED = {
  backend: [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "AGENT_SERVICE_SECRET",
    "CREDENTIAL_KEYS",
    "ACCESS_REQUEST_PEPPER",
    "APP_ORIGIN",
    "RENDERER_SECRET",
  ],
  frontend: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "AGENT_SERVICE_SECRET"],
};

export function composeNames(text) {
  const names = new Set();
  let inEnv = false;
  for (const line of text.split("\n")) {
    if (/^ {4}environment:\s*$/.test(line)) {
      inEnv = true;
      continue;
    }
    if (!inEnv) continue;
    const m = /^ {6}(?:- )?([A-Z][A-Z0-9_]*)(?:[=:]|$)/.exec(line);
    if (m) names.add(m[1]);
    else inEnv = false;
  }
  return names;
}

function load(dir, group) {
  const path = join(dir, group, ".env");
  let st;
  try {
    st = statSync(path);
  } catch {
    return { path, missing: true };
  }
  return {
    path,
    mode: st.mode & 0o777,
    values: new Map(parseEnv(readFileSync(path), `${group}/.env`).map((e) => [e.key, e.value.trim()])),
  };
}

export function check(dir, { compose = readFileSync(COMPOSE, "utf8") } = {}) {
  const shown = (p) => {
    const rel = relative(process.cwd(), p);
    return rel && !rel.startsWith("..") ? rel : p;
  };
  const errors = [];
  const warnings = [];
  const files = {};
  for (const group of Object.keys(REQUIRED)) {
    let f;
    try {
      f = load(dir, group);
    } catch (e) {
      errors.push(e.message);
      continue;
    }
    files[group] = f;
    const example = `${shown(join(dir, group, ".env.example"))}`;
    if (f.missing) {
      errors.push(`${shown(f.path)} is missing (start from ${example})`);
      continue;
    }
    const absent = REQUIRED[group].filter((k) => !f.values.get(k));
    if (absent.length) errors.push(`${shown(f.path)} lacks a value for: ${absent.join(", ")} (names in ${example})`);
    if (f.mode & 0o077) warnings.push(`${shown(f.path)} is readable by others (chmod 600 it)`);
  }
  const b = files.backend?.values;
  const fr = files.frontend?.values;
  if (
    b &&
    fr &&
    b.get("AGENT_SERVICE_SECRET") &&
    fr.get("AGENT_SERVICE_SECRET") &&
    b.get("AGENT_SERVICE_SECRET") !== fr.get("AGENT_SERVICE_SECRET")
  )
    errors.push("AGENT_SERVICE_SECRET differs between backend/.env and frontend/.env");
  if (b) {
    const given = composeNames(compose);
    const unused = [...b.keys()].filter((k) => !given.has(k));
    if (unused.length) warnings.push(`backend/.env sets names no container receives: ${unused.join(", ")}`);
  }
  return { errors, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { dir: { type: "string" } } });
  const dir = resolve(values.dir ?? DEFAULT_DIR);
  const { errors, warnings } = check(dir);
  for (const w of warnings) console.log(`env-check: warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.log(`env-check: ${e}`);
    console.log(
      "env-check: fill in the missing names, or migrate older env files (names, modes and sizes only are printed): node cloud/deploy/scripts/env-files.mjs --from <old checkout>/cloud/deploy --to cloud/deploy-config/env-files --copy --dry-run",
    );
    process.exit(1);
  }
  console.log("env-check: backend/.env and frontend/.env have every required name");
}
