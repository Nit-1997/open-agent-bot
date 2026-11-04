import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(import.meta.dirname, "..");
const UI = join(WEB, "../../packages/ui");
const read = (path: string) => readFileSync(join(WEB, path), "utf8");
const readUi = (path: string) => readFileSync(join(UI, path), "utf8");

const FONT_FILES = [
  "@fontsource/instrument-serif/latin-400.css",
  "@fontsource/instrument-serif/latin-400-italic.css",
  "@fontsource-variable/dm-sans/index.css",
  "@fontsource/dm-mono/latin-400.css",
  "@fontsource/dm-mono/latin-500.css",
];

const imports = (css: string) => [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map(([, spec]) => spec);

describe("self-hosted fonts", () => {
  it("leaves no next/font import in the code", () => {
    const grep = spawnSync("git", ["grep", "-n", "next/font", "--", "cloud/web", "packages", "e2e", ":!cloud/web/test/fonts.test.ts"], {
      cwd: join(WEB, "../.."),
      encoding: "utf8",
    });
    expect(grep.stdout).toBe("");
    expect(grep.status).toBe(1);
  });

  it("imports exactly the five latin font files", () => {
    expect(imports(readUi("src/styles/fonts.css"))).toEqual(FONT_FILES);
  });

  it("resolves every font file from ui", () => {
    const resolve = createRequire(join(UI, "package.json")).resolve;
    for (const spec of FONT_FILES) expect(() => resolve(spec)).not.toThrow();
  });

  it("loads fonts.css from the root layout's globals.css and keeps only h-full on <html>", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/^import "\.\/globals\.css";$/m);
    expect(read("app/globals.css")).toMatch(/^@import "@oab\/ui\/styles\/fonts\.css";$/m);
    expect(layout).toContain('className="h-full"');
  });

  it("maps the three families in the theme", () => {
    const css = readUi("src/styles/theme.css");
    expect(css).toContain('--font-display: "Instrument Serif", Georgia, serif;');
    expect(css).toContain('--font-sans: "DM Sans Variable", system-ui, sans-serif;');
    expect(css).toContain('--font-mono: "DM Mono", Menlo, monospace;');
  });
});
