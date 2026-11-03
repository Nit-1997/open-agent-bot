import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import allowlist from "./fixtures/id-spread-allowlist.json";

const REPO = join(import.meta.dirname, "../../..");
const ROOTS = ["packages/ui/src", "web/app", "web/components"];
const BASE_COUNT = 1005;

type Element = Readonly<{ at: string; file: string; tag: string; id: boolean; spread: boolean }>;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith(".tsx") ? [path] : [];
  });
}

function intrinsicElements(path: string): Element[] {
  const file = relative(REPO, path);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Element[] = [];
  const visit = (node: ts.Node) => {
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

const allowed = (e: Element) => e.spread && allowlist.some((a) => a.file === e.file && a.tag === e.tag);

describe("static ids", () => {
  const elements = ROOTS.flatMap((root) => tsxFiles(join(REPO, root))).flatMap(intrinsicElements);
  const covered = elements.filter((e) => e.id || allowed(e));

  it("gives every intrinsic JSX element an id", () => {
    console.log(`ids: ${covered.length}/${elements.length}`);
    expect(elements.filter((e) => !e.id && !allowed(e)).map((e) => e.at)).toEqual([]);
    expect(elements.length).toBeGreaterThanOrEqual(BASE_COUNT);
  });

  it("keeps the spread allowlist short, justified and in use", () => {
    expect(allowlist.length).toBeLessThanOrEqual(10);
    for (const entry of allowlist) {
      expect(entry.reason.trim().length, entry.file).toBeGreaterThan(10);
      expect(
        elements.some((e) => e.file === entry.file && e.tag === entry.tag && e.spread && !e.id),
        entry.file,
      ).toBe(true);
    }
  });
});
