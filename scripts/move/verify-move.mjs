#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const IMPORT_LINE = /^\s*(?:import\b|export\b[^"'`]*\bfrom\b|.*\brequire\s*\(|.*\bimport\s*\()/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'`])([^"'`]+)\1/g;
const WORD = /[\w@./${}*~+-]+/g;

const inside = (file, dirs) => dirs.some((d) => file === d || file.startsWith(`${d.replace(/\/$/, "")}/`));

export function parseNameStatus(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status, paths };
    });
}

export function checkRenames(entries, { moved, deleted }) {
  let renames = 0;
  const other = [];
  for (const e of entries) {
    if (e.status === "R100" && inside(e.paths[1], moved)) renames++;
    else if (e.status === "D" && deleted.includes(e.paths[0])) continue;
    else other.push(`commit 1: ${e.status} ${e.paths.join(" -> ")}`);
  }
  return { renames, other };
}

const specifiers = (line) => [...line.matchAll(SPECIFIER)].map((m) => m[2]);

export function isImportLine(oldLine, newLine) {
  if (!IMPORT_LINE.test(oldLine) || !IMPORT_LINE.test(newLine)) return false;
  const a = specifiers(oldLine);
  const b = specifiers(newLine);
  if (!a.length || a.length !== b.length) return false;
  let rebuilt = oldLine;
  a.forEach((spec, i) => {
    rebuilt = rebuilt.replace(spec, b[i]);
  });
  return rebuilt === newLine && a.some((s, i) => s !== b[i]);
}

const split = (line) => {
  const words = [];
  const seps = [];
  let last = 0;
  for (const m of line.matchAll(WORD)) {
    seps.push(line.slice(last, m.index));
    words.push(m[0]);
    last = m.index + m[0].length;
  }
  seps.push(line.slice(last));
  return { words, seps };
};

const depthless = (s) => s.replace(/(\.\.\/)+/g, "");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const replaceRow = (word, row) => word.replace(new RegExp(`(^|/)${escapeRe(row.old)}(?=/|$)`, "g"), (_, lead) => `${lead}${row.new}`);

export function pathChange(oldWord, newWord, rows) {
  const candidates = [oldWord, ...rows.map((r) => replaceRow(oldWord, r))];
  return candidates.some((c) => c === newWord || depthless(c) === depthless(newWord));
}

export function isPathLine(oldLine, newLine, rows) {
  const a = split(oldLine);
  const b = split(newLine);
  if (a.words.length !== b.words.length || a.seps.join("\0") !== b.seps.join("\0")) return null;
  const changed = a.words.map((w, i) => [w, b.words[i]]).filter(([x, y]) => x !== y);
  if (!changed.length) return null;
  return changed.every(([x, y]) => pathChange(x, y, rows)) ? changed : null;
}

export function parseDiff(text) {
  const files = [];
  let cur = null;
  let hunk = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = { from: null, to: null, hunks: [] };
      files.push(cur);
      hunk = null;
    } else if (!cur) continue;
    else if (line.startsWith("--- ")) cur.from = line === "--- /dev/null" ? null : line.slice(6);
    else if (line.startsWith("+++ ")) cur.to = line === "+++ /dev/null" ? null : line.slice(6);
    else if (line.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      hunk = { start: Number(m[1]), minus: [], plus: [] };
      cur.hunks.push(hunk);
    } else if (hunk && line.startsWith("-")) hunk.minus.push(line.slice(1));
    else if (hunk && line.startsWith("+")) hunk.plus.push(line.slice(1));
  }
  return files;
}

export function classify(files, { moved, allow, rows }) {
  const out = { importLines: 0, pathLines: [], other: [] };
  for (const f of files) {
    const path = f.to ?? f.from;
    if (!inside(path, moved) || allow.includes(path)) continue;
    if (!f.from || !f.to) {
      out.other.push(`${path}: ${f.from ? "deleted" : "added"} inside a moved directory`);
      continue;
    }
    for (const h of f.hunks) {
      const n = Math.max(h.minus.length, h.plus.length);
      for (let i = 0; i < n; i++) {
        const a = h.minus[i];
        const b = h.plus[i];
        const at = `${path}:${h.start + Math.min(i, Math.max(0, h.plus.length - 1))}`;
        if (a === undefined || b === undefined) {
          out.other.push(`${at}: unpaired ${a === undefined ? "+" : "-"} line`);
          continue;
        }
        if (isImportLine(a, b)) {
          out.importLines++;
          continue;
        }
        const changed = isPathLine(a, b, rows);
        if (changed) out.pathLines.push(`${at}: ${changed.map(([x, y]) => `${x} -> ${y}`).join(", ")}`);
        else out.other.push(`${at}: ${a.trim()} => ${b.trim()}`);
      }
    }
  }
  return out;
}

export function verifyMove({ cwd, base, c1, c2, moved, deleted = [], allow = [] }) {
  const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let rows = [];
  try {
    rows = JSON.parse(git(["show", `${c2}:scripts/boundary/moved-paths.json`]));
  } catch {
    rows = [];
  }
  const renames = checkRenames(parseNameStatus(git(["diff", "-M", "-l100000", "--name-status", base, c1])), { moved, deleted });
  const wiring = classify(parseDiff(git(["diff", "-M", "-l100000", "--unified=0", "--no-color", "--no-ext-diff", c1, c2])), {
    moved,
    allow,
    rows,
  });
  const other = [...renames.other, ...wiring.other];
  return {
    renames: renames.renames,
    importLines: wiring.importLines,
    pathLines: wiring.pathLines,
    other,
    text: [
      `renames=${renames.renames} import-lines=${wiring.importLines} path-lines=${wiring.pathLines.length} other=${other.length}`,
      ...wiring.pathLines.map((l) => `PATH ${l}`),
      ...other.map((l) => `OTHER ${l}`),
    ].join("\n"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      moved: { type: "string", multiple: true },
      deleted: { type: "string", multiple: true },
      allow: { type: "string", multiple: true },
    },
  });
  if (positionals.length !== 3 || !values.moved?.length) {
    process.stderr.write("usage: verify-move.mjs <base> <c1> <c2> --moved <dir>… [--deleted <path>…] [--allow <file>…]\n");
    process.exit(2);
  }
  const [base, c1, c2] = positionals;
  const r = verifyMove({ cwd: process.cwd(), base, c1, c2, moved: values.moved, deleted: values.deleted ?? [], allow: values.allow ?? [] });
  process.stdout.write(`${r.text}\n`);
  process.exit(r.other.length ? 1 : 0);
}
