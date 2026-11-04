import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { selectorsOf, selectorsOfDir, splitSelectors } from "../css-selectors.mjs";

describe("css-selectors", () => {
  it("lists every selector of a rule list, with at-rule context", () => {
    const css = `.a,.b:is(.c,.d){color:red}@media (min-width:40rem){.sm\\:p-2{padding:2px}}@layer base{@supports (x:y){a[href="a,b"]{x:y}}}`;
    assert.deepEqual([...selectorsOf(css)].sort(), [
      ".a",
      ".b:is(.c,.d)",
      '@layer base > @supports (x:y) > a[href="a,b"]',
      "@media (min-width:40rem) > .sm\\:p-2",
    ]);
  });

  it("describes @font-face by family, style, weight and display, without the source url", () => {
    const css = `@font-face{font-family:'DM Sans Variable';font-style:normal;font-weight:100 1000;font-display:swap;src:url(./x.woff2)}`;
    assert.deepEqual(
      [...selectorsOf(css)],
      ["@font-face font-family:'DM Sans Variable'; font-style:normal; font-weight:100 1000; font-display:swap"],
    );
  });

  it("adds a line for each --font-* custom property and ignores other declarations", () => {
    const css = `:root,:host{--font-sans:"DM Sans Variable", system-ui;--color-bg:#fff}`;
    assert.deepEqual([...selectorsOf(css)].sort(), [":host", ":root", ':root,:host { --font-sans: "DM Sans Variable", system-ui }']);
  });

  it("keeps statements, @property and keyframe steps; skips comments", () => {
    const css = `/* {x} */@layer theme,base;@property --tw-a{syntax:"*";inherits:false}@keyframes spin{to{transform:rotate(1turn)}}`;
    assert.deepEqual([...selectorsOf(css)].sort(), ["@keyframes spin > to", "@layer theme,base", "@property --tw-a"]);
  });

  it("splits selector lists only at top-level commas", () => {
    assert.deepEqual(splitSelectors(':where(.a,.b) > .c, [data-x="1,2"]'), [":where(.a,.b) > .c", '[data-x="1,2"]']);
  });

  it("treats a backslash-escaped quote in a selector as part of the selector, not a string", () => {
    const css = `.content-\\"x\\"{color:red}.a\\'b{x:y}@font-face{font-family:'DM Mono';font-style:normal;font-weight:400;font-display:swap}`;
    assert.deepEqual([...selectorsOf(css)].sort(), [
      ".a\\'b",
      '.content-\\"x\\"',
      "@font-face font-family:'DM Mono'; font-style:normal; font-weight:400; font-display:swap",
    ]);
    assert.deepEqual(splitSelectors('.a\\",.b'), ['.a\\"', ".b"]);
  });

  it("reads static/**.css under a Next build dir, sorted and de-duplicated", () => {
    const dir = mkdtempSync(join(tmpdir(), "css-sel-"));
    try {
      mkdirSync(join(dir, "static/chunks"), { recursive: true });
      mkdirSync(join(dir, "server"), { recursive: true });
      writeFileSync(join(dir, "static/chunks/a.css"), ".z{}.a{}");
      writeFileSync(join(dir, "static/b.css"), ".a{}");
      writeFileSync(join(dir, "server/ignored.css"), ".server{}");
      assert.deepEqual(selectorsOfDir(dir), [".a", ".z"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
