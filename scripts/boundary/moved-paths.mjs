#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function loadRows(root) {
  const path = join(root, "scripts/boundary/moved-paths.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

export function rowProblems(rows) {
  if (!Array.isArray(rows)) return ["moved-paths.json must be an array"];
  return rows.flatMap((r, i) => {
    const at = `row ${i}`;
    const out = [];
    for (const k of ["old", "new"]) if (typeof r?.[k] !== "string" || !r[k]) out.push(`${at}: ${k} must be a non-empty string`);
    if (typeof r?.pr !== "string" || !/^6\.\d$/.test(r.pr)) out.push(`${at}: pr must look like 6.<n>`);
    if (!Array.isArray(r?.allow)) out.push(`${at}: allow must be an array`);
    else
      r.allow.forEach((a, j) => {
        if (typeof a?.file !== "string" || !a.file) out.push(`${at} allow ${j}: file must be a non-empty string`);
        if (typeof a?.reason !== "string" || !a.reason.trim()) out.push(`${at} allow ${j}: needs a reason`);
      });
    return out;
  });
}

export const tokenPattern = (old) => new RegExp(`(?<![\\w@./-])${escapeRe(old)}(?=/|$|["'\`\\s)])`, "m");

const allowed = (row, file) =>
  file.startsWith("docs/superpowers/") ||
  row.allow.some((a) => (a.file.endsWith("/**") ? file.startsWith(a.file.slice(0, -2)) : a.file === file));

export function staleHits(root, rows = loadRows(root)) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const hits = [];
  for (const row of rows) {
    for (const f of git(["ls-files", "-z", "--", row.old]).split("\0").filter(Boolean))
      hits.push({ kind: "TRACKED", file: f, line: 0, old: row.old });
    const re = tokenPattern(row.old);
    for (const file of files) {
      if (allowed(row, file)) continue;
      let buf;
      try {
        buf = readFileSync(join(root, file));
      } catch {
        continue;
      }
      if (buf.includes(0)) continue;
      buf
        .toString("utf8")
        .split("\n")
        .forEach((text, i) => {
          if (re.test(text)) hits.push({ kind: "STALE", file, line: i + 1, old: row.old });
        });
    }
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" } } });
  const root = resolve(values.root ?? join(HERE, "../.."));
  const rows = loadRows(root);
  const problems = rowProblems(rows);
  for (const p of problems) process.stdout.write(`INVALID ${p}\n`);
  if (problems.length) process.exit(1);
  const hits = staleHits(root, rows);
  process.stdout.write(`moved-paths: ${rows.length} rows, ${hits.length} stale\n`);
  for (const h of hits) process.stdout.write(`${h.kind} ${h.file}${h.line ? `:${h.line}` : ""} ${h.old}\n`);
  process.exit(hits.length ? 1 : 0);
}
