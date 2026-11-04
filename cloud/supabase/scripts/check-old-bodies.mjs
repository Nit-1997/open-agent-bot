#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROLLBACK = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "rollback", "m7.sql");
export const FUNCTIONS = Object.freeze(["private.handle_new_user()", "private.before_user_created(jsonb)"]);
export const BODIES_QUERY = `select json_object_agg(p.oid::regprocedure::text, p.prosrc) from pg_proc p where p.oid in (${FUNCTIONS.map(
  (f) => `'${f}'::regprocedure`,
).join(", ")})`;

const USAGE = 'usage: psql … -XAtc "$(check-old-bodies.mjs --query)" | check-old-bodies.mjs';

const signature = (name, args) => {
  const types = args
    .split(",")
    .map((a) => a.trim().split(/\s+/).at(-1))
    .filter(Boolean);
  return `${name}(${types.join(",")})`;
};

export function rollbackBodies(text = readFileSync(ROLLBACK, "utf8")) {
  const out = {};
  for (const m of text.matchAll(/create or replace function ([\w.]+)\(([^)]*)\)[\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g))
    out[signature(m[1], m[2])] = m[3];
  return out;
}

export function compareBodies(live, want = rollbackBodies()) {
  const problems = [];
  const missing = [];
  const matches = [];
  for (const f of FUNCTIONS) {
    if (typeof want[f] !== "string") problems.push(`${f} is not in rollback/m7.sql`);
    else if (typeof live?.[f] !== "string") missing.push(`${f} is missing from the database answer`);
    else if (live[f] === want[f]) matches.push(`${f} matches rollback/m7.sql`);
    else problems.push(`${f} differs from rollback/m7.sql`);
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
