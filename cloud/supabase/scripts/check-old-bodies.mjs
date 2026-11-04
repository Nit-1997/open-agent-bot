#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROLLBACK = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "rollback", "m7.sql");
export const FUNCTIONS = Object.freeze(["private.handle_new_user()", "private.before_user_created(jsonb)"]);
export const BODIES_QUERY = `select json_object_agg(p.oid::regprocedure::text, json_build_object('prosrc', p.prosrc, 'prosecdef', p.prosecdef, 'provolatile', p.provolatile, 'proconfig', p.proconfig)) from pg_proc p where p.oid in (${FUNCTIONS.map(
  (f) => `'${f}'::regprocedure`,
).join(", ")})`;
export const ATTRIBUTES = Object.freeze(["prosrc", "prosecdef", "provolatile", "proconfig"]);

const USAGE = 'usage: psql … -XAtc "$(check-old-bodies.mjs --query)" | check-old-bodies.mjs';

const signature = (name, args) => {
  const types = args
    .split(",")
    .map((a) => a.trim().split(/\s+/).at(-1))
    .filter(Boolean);
  return `${name}(${types.join(",")})`;
};

const VOLATILITY = { immutable: "i", stable: "s", volatile: "v" };

export function headerAttributes(header) {
  const h = header.toLowerCase();
  const volatility = /\b(immutable|stable|volatile)\b/.exec(h)?.[1] ?? "volatile";
  const config = [...header.matchAll(/\bset\s+(\w+)\s*(?:=|to)\s*'([^']*)'/gi)].map((m) => `${m[1].toLowerCase()}=${m[2]}`);
  return { prosecdef: /\bsecurity\s+definer\b/.test(h), provolatile: VOLATILITY[volatility], proconfig: config.length ? config : null };
}

const normalConfig = (config) =>
  Array.isArray(config) ? config.map((c) => String(c).replace(/^([^=]+)="(.*)"$/, "$1=$2")) : config === null ? null : undefined;

export function rollbackBodies(text = readFileSync(ROLLBACK, "utf8")) {
  const out = {};
  for (const m of text.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)([\s\S]*?)\bas \$\$([\s\S]*?)\$\$;/g))
    out[signature(m[1], m[2])] = { prosrc: m[4], ...headerAttributes(m[3]) };
  return out;
}

const wellFormed = (row) =>
  row !== null &&
  typeof row === "object" &&
  typeof row.prosrc === "string" &&
  typeof row.prosecdef === "boolean" &&
  typeof row.provolatile === "string" &&
  normalConfig(row.proconfig) !== undefined;

export function compareBodies(live, want = rollbackBodies()) {
  const problems = [];
  const missing = [];
  const matches = [];
  for (const f of FUNCTIONS) {
    const w = want[f];
    const l = live?.[f];
    if (!w) {
      problems.push(`${f} is not in rollback/m7.sql`);
      continue;
    }
    if (!wellFormed(l)) {
      missing.push(`${f} is missing from the database answer (or lacks ${ATTRIBUTES.join(", ")})`);
      continue;
    }
    const differ = ATTRIBUTES.filter((a) =>
      a === "proconfig" ? JSON.stringify(normalConfig(l.proconfig)) !== JSON.stringify(w.proconfig) : l[a] !== w[a],
    );
    if (differ.length) problems.push(`${f} differs from rollback/m7.sql (${differ.join(", ")})`);
    else matches.push(`${f} matches rollback/m7.sql`);
  }
  return { problems, missing, matches };
}

export function main(argv, input, { out = console.log, err = console.error } = {}) {
  if (argv.length === 1 && argv[0] === "--query") {
    out(BODIES_QUERY);
    return 0;
  }
  if (argv.length) {
    err(USAGE);
    return 2;
  }
  let live;
  try {
    live = JSON.parse(input().trim());
  } catch {
    live = undefined;
  }
  if (!live || typeof live !== "object" || Array.isArray(live)) {
    err("STOP: the input is not the JSON object the query returns (did psql fail? its error is above)");
    err(USAGE);
    return 2;
  }
  const r = compareBodies(live);
  for (const l of r.matches) out(l);
  if (r.missing.length) {
    for (const l of r.missing) err(`STOP: ${l}`);
    return 2;
  }
  if (r.problems.length) {
    for (const l of r.problems) err(`STOP: ${l}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2), () => readFileSync(0, "utf8"));
