#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ID_ROOTS = ["packages/ui/src", "packages/local-web/src", "web/app", "web/components"];
export const BASE_COUNT = 1005;
export const ALLOWLIST = JSON.parse(readFileSync(join(REPO, "scripts/id-spread-allowlist.json"), "utf8"));

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith(".tsx") ? [path] : [];
  });
}

function intrinsicElements(repo, path) {
  const file = relative(repo, path);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (/^[a-z][\w-]*$/.test(tag)) {
        const props = node.attributes.properties;
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push({
          at: `${file}:${line} <${tag}>`,
          file,
          tag,
          id: props.some((p) => ts.isJsxAttribute(p) && p.name.getText(source) === "id"),
          spread: props.some((p) => ts.isJsxSpreadAttribute(p)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

export function scanIds({ repo, roots, allowlist }) {
  const elements = roots.flatMap((root) => tsxFiles(join(repo, root))).flatMap((path) => intrinsicElements(repo, path));
  const allowed = (e) => e.spread && allowlist.some((a) => a.file === e.file && a.tag === e.tag);
  const unusedAllowlist = allowlist.filter((a) => !elements.some((e) => e.file === a.file && e.tag === a.tag && e.spread && !e.id));
  return {
    elements,
    covered: elements.filter((e) => e.id || allowed(e)),
    missing: elements.filter((e) => !e.id && !allowed(e)).map((e) => e.at),
    unusedAllowlist,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = process.argv.length > 2 ? process.argv.slice(2) : ID_ROOTS;
  const { elements, covered, missing } = scanIds({ repo: REPO, roots, allowlist: ALLOWLIST });
  process.stdout.write(`ids: ${covered.length}/${elements.length}\n`);
  for (const at of missing) process.stdout.write(`missing id: ${at}\n`);
  if (missing.length) process.exit(1);
}
