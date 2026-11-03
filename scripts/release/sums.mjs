#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, main } from "./cli.mjs";
import { parseSums, SUMS_NAME, sha256Hex, sha256sums, summedFiles } from "./releaseLib.mjs";

const listed = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.name !== SUMS_NAME)
    .map((e) => e.name)
    .sort();

export function setProblems(dir, version) {
  const want = summedFiles(version);
  const have = listed(dir);
  const out = [];
  for (const n of want) if (!have.includes(n)) out.push(`missing ${n}`);
  for (const n of have) if (!want.includes(n)) out.push(`unexpected ${n}`);
  return out;
}

export function writeSums(dir, version) {
  const bad = setProblems(dir, version);
  if (bad.length) throw new Error(`${dir} must hold exactly ${summedFiles(version).join(", ")}: ${bad.join(", ")}`);
  const text = sha256sums(summedFiles(version).map((name) => ({ name, sha256: sha256Hex(readFileSync(join(dir, name))) })));
  writeFileSync(join(dir, SUMS_NAME), text, { mode: 0o644 });
  return text;
}

export function verifySums(dir, version) {
  const out = [];
  const entries = parseSums(readFileSync(join(dir, SUMS_NAME), "utf8"));
  const names = entries.map((e) => e.name);
  if (JSON.stringify(names) !== JSON.stringify(summedFiles(version)))
    out.push(`SHA256SUMS lists [${names.join(", ")}], expected [${summedFiles(version).join(", ")}] in that order`);
  for (const e of entries) {
    let actual;
    try {
      actual = sha256Hex(readFileSync(join(dir, e.name)));
    } catch {
      out.push(`${e.name}: missing`);
      continue;
    }
    if (actual !== e.sha256) out.push(`${e.name}: sha256 ${actual} differs from SHA256SUMS ${e.sha256}`);
  }
  out.push(...setProblems(dir, version));
  return out;
}

if (isMain(import.meta.url))
  main("sums", () => {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: { version: { type: "string" }, check: { type: "boolean" } },
    });
    if (positionals.length !== 1 || !values.version) throw new Error("usage: sums.mjs <dir> --version <v> [--check]");
    const dir = positionals[0];
    if (!values.check) process.stdout.write(writeSums(dir, values.version));
    const bad = verifySums(dir, values.version);
    for (const b of bad) process.stderr.write(`sums: ${b}\n`);
    if (bad.length) return 1;
    process.stdout.write(`sums: ${join(dir, SUMS_NAME)} verified (${summedFiles(values.version).length} files)\n`);
    return 0;
  });
