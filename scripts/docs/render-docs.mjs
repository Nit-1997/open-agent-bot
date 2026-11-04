#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { marked } from "marked";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const DOCS = Object.freeze(
  [
    ["readme", "README.md"],
    ["install", "docs/INSTALL.md"],
    ["releasing", "docs/RELEASING.md"],
    ["security", "SECURITY.md"],
  ].map(([key, source]) => Object.freeze({ key, source, path: join(REPO, source) })),
);

const START_TAG = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*?)?)(\/?)>/g;
const ID_ATTR = /\s+id\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/gi;

const STYLE = [
  "body{margin:0;background:#f6f7f9;color:#1d2330;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
  "main{max-width:880px;margin:0 auto;padding:32px 40px 96px;background:#fff;min-height:100vh;box-sizing:border-box}",
  "header{position:sticky;top:0;background:#1d2330;color:#fff;padding:8px 16px;font:13px monospace;z-index:1}",
  "pre{background:#0f1420;color:#e7ecf3;padding:12px 14px;border-radius:6px;overflow:auto;font-size:13px;line-height:1.45}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
  ":not(pre)>code{background:#eef1f5;padding:1px 5px;border-radius:4px;font-size:.9em}",
  "table{border-collapse:collapse;margin:12px 0}th,td{border:1px solid #d5dbe3;padding:6px 10px;text-align:left;vertical-align:top}",
  "blockquote{margin:0;padding:0 16px;border-left:4px solid #d5dbe3;color:#4a5568}",
  "h1,h2,h3{line-height:1.25}h2{border-bottom:1px solid #e3e7ed;padding-bottom:4px;margin-top:36px}",
].join("\n");

const escapeHtml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function addIds(html, file) {
  const counts = new Map();
  return html.replace(START_TAG, (_m, tag, attrs, slash) => {
    const t = tag.toLowerCase();
    const n = (counts.get(t) ?? 0) + 1;
    counts.set(t, n);
    return `<${tag} id="doc-${file}-${t}-${n}"${attrs.replace(ID_ATTR, "")}${slash}>`;
  });
}

export function idProblems(html) {
  const out = [];
  const seen = new Map();
  for (const m of html.matchAll(START_TAG)) {
    const id = /\sid="([^"]*)"/.exec(m[2])?.[1];
    if (!id) out.push(`<${m[1].toLowerCase()}> has no id`);
    else seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const dup = [...seen].filter(([, n]) => n > 1).map(([id, n]) => `duplicate id ${id} (${n})`);
  return [...dup, ...out];
}

const page = (title, body) =>
  [
    "<!DOCTYPE html>",
    '<html lang="en">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>`,
    `<body><header>${escapeHtml(title)} · rendered by scripts/docs/render-docs.mjs</header><main>`,
    body,
    "</main></body>",
    "</html>",
    "",
  ].join("\n");

export function renderDoc(markdown, { file, title }) {
  return addIds(page(title, marked.parse(markdown, { async: false, gfm: true })), file);
}

function renderIndex() {
  const items = DOCS.map((d) => `<li><a href="${d.key}.html">${escapeHtml(d.source)}</a></li>`).join("\n");
  return addIds(page("Open Agent docs", `<h1>Open Agent docs</h1>\n<ul>\n${items}\n</ul>`), "index");
}

export function renderAll({ out, render = renderDoc }) {
  const pages = [
    ...DOCS.map((d) => ({ name: `${d.key}.html`, html: render(readFileSync(d.path, "utf8"), { file: d.key, title: d.source }) })),
    { name: "index.html", html: renderIndex() },
  ];
  for (const p of pages) {
    const problems = idProblems(p.html);
    if (problems.length) throw new Error(`${p.name}: ${problems.slice(0, 5).join("; ")}`);
  }
  mkdirSync(out, { recursive: true });
  return pages.map((p) => {
    const file = join(out, p.name);
    writeFileSync(file, p.html, { mode: 0o644 });
    return file;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) {
    process.stderr.write("usage: render-docs.mjs --out <dir>\n");
    process.exit(2);
  }
  try {
    for (const f of renderAll({ out: resolve(values.out) })) {
      const ids = (readFileSync(f, "utf8").match(/\sid="/g) ?? []).length;
      process.stdout.write(`[render-docs] ${f} ${ids} elements, every id unique\n`);
    }
  } catch (e) {
    process.stderr.write(`render-docs: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
