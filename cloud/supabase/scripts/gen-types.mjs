#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDbUrl, REFUSAL_CODE, Refusal, refuseEnv } from "./local-stack.mjs";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agent", "src", "store", "database.types.ts");

export function localTypesArgs(env) {
  refuseEnv(env);
  const raw = env.OAB_SB_DB_URL?.trim();
  if (!raw) throw new Refusal('--local needs OAB_SB_DB_URL (eval "$(node cloud/supabase/scripts/local-stack.mjs env --name <x>)")');
  const url = new URL(checkDbUrl(raw));
  url.searchParams.set("sslmode", "disable");
  return ["gen", "types", "--lang", "typescript", "--db-url", url.toString(), "--schema", "public"];
}

const INTERNALS = /^ {2}\/\/ Allows to automatically[^\n]*\n(?: {2}\/\/[^\n]*\n)* {2}__InternalSupabase: \{\n[^}]*\n {2}\}\n/m;

export function keepInternals(generated, previous) {
  if (/^ {2}__InternalSupabase: \{/m.test(generated)) return generated;
  const block = INTERNALS.exec(previous ?? "")?.[0];
  return block ? generated.replace("export type Database = {\n", `export type Database = {\n${block}`) : generated;
}

function local(env, run) {
  const res = run("supabase", localTypesArgs(env), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
  });
  if (res.error || res.status !== 0 || !res.stdout.includes("export type Database"))
    throw new Error(
      `supabase gen types failed (exit ${res.status ?? "none"}): ${res.error?.message ?? res.stderr.trim().split("\n").at(-1)}`,
    );
  return res.stdout;
}

async function hosted(env) {
  const need = (name) => {
    const v = env[name]?.trim();
    if (!v) throw new Error(`missing ${name} (load cloud/deploy/env-files/.env-supabase-admin)`);
    return v;
  };
  const res = await fetch(`https://api.supabase.com/v1/projects/${need("SUPABASE_PROJECT_REF")}/types/typescript?included_schemas=public`, {
    headers: { authorization: `Bearer ${need("SUPABASE_ACCESS_TOKEN")}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`type generation failed: HTTP ${res.status}`);
  return (await res.json()).types;
}

const previousTypes = () => (existsSync(OUT) ? readFileSync(OUT, "utf8") : undefined);

export async function main(
  argv,
  { env = process.env, run = spawnSync, write = writeFileSync, out = console.log, previous = previousTypes } = {},
) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--local")) throw new Refusal("usage: gen-types.mjs [--local]");
  const types = argv[0] === "--local" ? keepInternals(local(env, run), previous()) : await hosted(env);
  write(OUT, types);
  out(`wrote ${OUT}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Refusal ? `${REFUSAL_CODE}: ${e.message}` : e.message);
      process.exit(e instanceof Refusal ? 2 : 1);
    },
  );
}
