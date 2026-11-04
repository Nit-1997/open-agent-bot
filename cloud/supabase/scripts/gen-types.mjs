#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agent", "src", "store", "database.types.ts");

const env = (name) => {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`missing ${name} (load cloud/deploy/env-files/.env-supabase-admin)`);
    process.exit(1);
  }
  return v;
};

const res = await fetch(`https://api.supabase.com/v1/projects/${env("SUPABASE_PROJECT_REF")}/types/typescript?included_schemas=public`, {
  headers: { authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}` },
  signal: AbortSignal.timeout(30_000),
});
if (!res.ok) {
  console.error(`type generation failed: HTTP ${res.status}`);
  process.exit(1);
}
const { types } = await res.json();
writeFileSync(OUT, types);
console.log(`wrote ${OUT}`);
