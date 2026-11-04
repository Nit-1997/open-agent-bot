#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { apiBaseFrom, managementApi } from "./managementApi.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, "..", "data");
export const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
export const BATCH = 1000;
export const REFUSAL_CODE = "local_stack_only";
export const LIVE_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_URL", "LIVE_DB_URL"];
const USAGE = "usage: blocked-domains.mjs --check | --apply [--local] [--api-base http://127.0.0.1:<port>/v1]";

export class Refusal extends Error {
  constructor(message) {
    super(`${REFUSAL_CODE}: ${message}`);
    this.name = "Refusal";
    this.code = REFUSAL_CODE;
  }
}

export function pinnedSha(sourceMd) {
  const m = /\|\s*SHA-256\s*\|\s*`([0-9a-f]{64})`\s*\|/.exec(sourceMd);
  if (!m) throw new Error("SOURCE.md has no SHA-256 row");
  return m[1];
}

export function loadList(dir = DATA_DIR) {
  const raw = readFileSync(join(dir, "disposable-domains.txt"));
  const sha = createHash("sha256").update(raw).digest("hex");
  const want = pinnedSha(readFileSync(join(dir, "SOURCE.md"), "utf8"));
  if (sha !== want) throw new Error(`disposable-domains.txt SHA-256 ${sha} doesn't match SOURCE.md (${want})`);
  const lines = raw.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const bad = lines.findIndex((l) => !DOMAIN_RE.test(l) || l.length > 253);
  if (bad >= 0) throw new Error(`disposable-domains.txt line ${bad + 1} isn't a lower-case domain`);
  if (new Set(lines).size !== lines.length) throw new Error("disposable-domains.txt has duplicate lines");
  return lines;
}

export function localDbUrl(env) {
  const live = LIVE_ENV.filter((k) => env[k]);
  if (live.length) throw new Refusal(`refusing --local with ${live.join(", ")} set`);
  const raw = env.OAB_SB_DB_URL;
  if (!raw) throw new Refusal('--local needs OAB_SB_DB_URL (eval "$(node cloud/supabase/scripts/local-stack.mjs env --name <x>)")');
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Refusal("OAB_SB_DB_URL is not a URL");
  }
  const port = Number(u.port);
  if (!/^postgres(ql)?:$/.test(u.protocol) || u.hostname !== "127.0.0.1" || !(port >= 18700 && port <= 18749))
    throw new Refusal("OAB_SB_DB_URL must be postgresql://…@127.0.0.1:<18700-18749>/…");
  return raw;
}

export function drift(listed, stored) {
  const want = new Set(listed);
  const have = new Set(stored);
  return { missing: listed.filter((d) => !have.has(d)), extra: stored.filter((d) => !want.has(d)).sort() };
}

const chunks = (items) => Array.from({ length: Math.ceil(items.length / BATCH) }, (_, i) => items.slice(i * BATCH, (i + 1) * BATCH));
const literal = (d) => {
  if (!DOMAIN_RE.test(d)) throw new Error("refusing to quote a value that isn't a domain");
  return `'${d}'`;
};

async function localDb(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    stored: async () => (await client.query("select domain from public.blocked_email_domains")).rows.map((r) => r.domain),
    insert: (batch) =>
      client.query("insert into public.blocked_email_domains (domain) select unnest($1::text[]) on conflict do nothing", [batch]),
    remove: (batch) => client.query("delete from public.blocked_email_domains where domain = any($1::text[])", [batch]),
    close: () => client.end(),
  };
}

function remoteDb(env, argv) {
  const ref = env.SUPABASE_PROJECT_REF?.trim();
  const token = env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!ref || !token)
    throw new Error("missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN (load cloud/deploy/env-files/.env-supabase-admin)");
  const m = managementApi({ base: apiBaseFrom(argv).base, ref, token });
  return {
    stored: async () => ((await m.read("select domain from public.blocked_email_domains")) ?? []).map((r) => r.domain),
    insert: (batch) =>
      m.write(
        `insert into public.blocked_email_domains (domain) values ${batch.map((d) => `(${literal(d)})`).join(",")} on conflict do nothing`,
      ),
    remove: (batch) => m.write(`delete from public.blocked_email_domains where domain in (${batch.map(literal).join(",")})`),
    close: async () => {},
  };
}

const sample = (items) => items.slice(0, 5).join(", ") + (items.length > 5 ? ", …" : "");

export async function main(argv = process.argv.slice(2), env = process.env) {
  const mode = argv.includes("--apply") ? "apply" : argv.includes("--check") ? "check" : undefined;
  if (!mode) throw new Error(USAGE);
  const listed = loadList();
  const db = argv.includes("--local") ? await localDb(localDbUrl(env)) : remoteDb(env, argv);
  try {
    let d = drift(listed, await db.stored());
    console.log(`blocked domains: ${listed.length} listed, ${d.missing.length} missing, ${d.extra.length} extra`);
    if (d.missing.length) console.log(`missing: ${sample(d.missing)}`);
    if (d.extra.length) console.log(`extra: ${sample(d.extra)}`);
    if (mode === "check") return d.missing.length || d.extra.length ? 1 : 0;
    for (const batch of chunks(d.missing)) await db.insert(batch);
    for (const batch of chunks(d.extra)) await db.remove(batch);
    d = drift(listed, await db.stored());
    if (d.missing.length || d.extra.length)
      throw new Error(`still drifting after apply: ${d.missing.length} missing, ${d.extra.length} extra`);
    console.log(`blocked domains: applied (${listed.length} in the database)`);
    return 0;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(err?.code === REFUSAL_CODE ? 2 : 1);
    },
  );
}
