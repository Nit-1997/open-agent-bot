#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FONT_FACE_KEYS = ["font-family", "font-style", "font-weight", "font-display"];

const squash = (text) => text.replace(/\s+/g, " ").trim();

function readString(css, i) {
  const quote = css[i];
  let j = i + 1;
  while (j < css.length && css[j] !== quote) j += css[j] === "\\" ? 2 : 1;
  return j + 1;
}

function parseBlock(css, start) {
  const node = { decls: [], children: [], end: css.length };
  let buf = "";
  let i = start;
  const flush = () => {
    const text = squash(buf);
    buf = "";
    if (!text) return;
    if (text.startsWith("@")) node.children.push({ prelude: text, statement: true });
    else {
      const colon = text.indexOf(":");
      if (colon > 0) node.decls.push([text.slice(0, colon).trim(), text.slice(colon + 1).trim()]);
    }
  };
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      i = close < 0 ? css.length : close + 2;
    } else if (c === "\\") {
      buf += css.slice(i, i + 2);
      i += 2;
    } else if (c === '"' || c === "'") {
      const next = readString(css, i);
      buf += css.slice(i, next);
      i = next;
    } else if (c === "{") {
      const prelude = squash(buf);
      buf = "";
      const child = parseBlock(css, i + 1);
      node.children.push({ prelude, ...child });
      i = child.end;
    } else if (c === "}") {
      flush();
      node.end = i + 1;
      return node;
    } else if (c === ";") {
      flush();
      i++;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return node;
}

export function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (c === "\\") {
      current += prelude.slice(i, i + 2);
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const next = readString(prelude, i);
      current += prelude.slice(i, next);
      i = next - 1;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += c;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const fontLines = (prefix, owner, decls) =>
  decls.filter(([name]) => name.startsWith("--font-")).map(([name, value]) => `${prefix}${owner} { ${name}: ${value} }`);

function emit(node, context, out) {
  const prefix = context.length ? `${context.join(" > ")} > ` : "";
  for (const child of node.children) {
    const { prelude } = child;
    if (child.statement) {
      out.add(`${prefix}${prelude}`);
      continue;
    }
    if (/^@font-face\b/i.test(prelude)) {
      const props = new Map(child.decls.map(([k, v]) => [k.toLowerCase(), v]));
      out.add(`${prefix}@font-face ${FONT_FACE_KEYS.map((k) => `${k}:${props.get(k) ?? ""}`).join("; ")}`);
      continue;
    }
    if (/^@property\b/i.test(prelude)) {
      out.add(`${prefix}${prelude}`);
      continue;
    }
    if (prelude.startsWith("@")) {
      emit(child, [...context, prelude], out);
      continue;
    }
    for (const selector of splitSelectors(prelude)) out.add(`${prefix}${selector}`);
    for (const line of fontLines(prefix, prelude, child.decls)) out.add(line);
    if (child.children.length) emit(child, [...context, prelude], out);
  }
}

export function selectorsOf(css) {
  const out = new Set();
  emit(parseBlock(css, 0), [], out);
  return out;
}

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(path);
    return e.name.endsWith(".css") ? [path] : [];
  });
}

export function selectorsOfDir(dir) {
  const root = existsSync(join(dir, "static")) ? join(dir, "static") : dir;
  const all = new Set();
  for (const file of cssFiles(root)) for (const line of selectorsOf(readFileSync(file, "utf8"))) all.add(line);
  return [...all].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error("usage: node scripts/css-selectors.mjs <build dir: web/.next or a folder of css files>");
    process.exit(2);
  }
  const lines = selectorsOfDir(dir);
  if (lines.length === 0) {
    console.error(`no CSS found under ${dir}`);
    process.exit(1);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
