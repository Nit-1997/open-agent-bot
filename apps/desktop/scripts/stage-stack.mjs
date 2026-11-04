#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");
const FILES = [
  ["docker-compose.yml", "docker-compose.yml"],
  ["local/renderer/seccomp.json", "local/renderer/seccomp.json"],
];

const { values } = parseArgs({ options: { out: { type: "string" }, lock: { type: "string" } } });
const out = resolve(values.out ?? join(APP, "build/stack"));
const lockPath = resolve(values.lock ?? join(APP, "services.lock.json"));
const expected = new Set([...FILES.map(([, to]) => to), "services.lock.json"]);

const fail = (msg) => {
  process.stderr.write(`stage-stack: ${msg}\n`);
  process.exit(1);
};

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

if (existsSync(out)) for (const f of walk(out)) if (!expected.has(relative(out, f))) fail(`unexpected file ${relative(out, f)} in ${out}`);

const composeSha256 = createHash("sha256")
  .update(readFileSync(join(REPO, "docker-compose.yml")))
  .digest("hex");
let lock;
try {
  lock = JSON.parse(readFileSync(lockPath, "utf8"));
} catch (e) {
  fail(`cannot read ${lockPath}: ${e.message}`);
}
if (lock?.composeSha256 !== composeSha256)
  fail(`composeSha256 in ${lockPath} is ${lock?.composeSha256}, the root docker-compose.yml is ${composeSha256}`);

for (const [from, to] of FILES) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(join(REPO, from), join(out, to));
}
copyFileSync(lockPath, join(out, "services.lock.json"));
process.stdout.write(`stage-stack: ${out} compose=${composeSha256.slice(0, 12)}\n`);
