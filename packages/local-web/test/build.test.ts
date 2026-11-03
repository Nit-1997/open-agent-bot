// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
let out = "";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : [path];
  });
}

const built = () => files(out).map((path) => relative(out, path));
const read = (path: string) => readFileSync(join(out, path), "utf8");
const css = () =>
  built()
    .filter((path) => path.endsWith(".css"))
    .map(read)
    .join("\n");

const selectorPattern = (cls: string) => new RegExp(`(^|[^\\w-])\\.${cls}(?![\\w-])[^{]*\\{`, "m");

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "oab-local-web-build-"));
  await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
}, 120000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe("vite build", () => {
  it("writes index.html and puts everything else under assets/", () => {
    const paths = built();
    expect(paths).toContain("index.html");
    expect(paths.filter((path) => path !== "index.html" && !path.startsWith("assets/"))).toEqual([]);
    expect(paths.filter((path) => path.endsWith(".map"))).toEqual([]);
  });

  it("index.html references only /assets/*", () => {
    const html = read("index.html");
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(([, ref]) => ref);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => !ref.startsWith("/assets/"))).toEqual([]);
    for (const ref of refs) expect(built()).toContain(ref.slice(1));
  });

  it("index.html has no inline script and keeps the root element and title", () => {
    const html = read("index.html");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc="\/assets\//);
      expect(body.trim()).toBe("");
    }
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<title id="root-title">Open Agent</title>');
  });

  it("loads nothing from Google Fonts or any other host", () => {
    for (const path of built().filter((p) => /\.(html|css|js)$/.test(p))) expect(read(path), path).not.toContain("fonts.googleapis");
    expect(css()).not.toMatch(/@import\s+url\(\s*["']?https?:/);
    expect(css()).not.toMatch(/url\(\s*["']?https?:/);
  });

  it("bundles the fonts and the backdrop", () => {
    const paths = built();
    expect(paths.some((path) => /^assets\/.+\.woff2$/.test(path))).toBe(true);
    expect(paths.some((path) => /^assets\/backdrop-[\w-]+\.jpg$/.test(path))).toBe(true);
    expect(css()).toMatch(/url\(\/assets\/backdrop-[\w-]+\.jpg\)/);
  });

  it("the CSS has the theme tokens and the utilities the ui uses", () => {
    const text = css();
    for (const token of ["--bg:", "--text-primary:", "--mist-500:", "--glass-bg:"]) expect(text).toContain(token);
    expect(text).toContain("@font-face");
    for (const cls of ["h-full", "text-text-primary", "orb", "glass"]) expect(text, cls).toMatch(selectorPattern(cls));
  });

  it("the CSS has no selectors that only test files would bring in", () => {
    const text = css();
    for (const cls of ["resize", "container", "static"]) expect(text, cls).not.toMatch(selectorPattern(cls));
  });

  it("the JS carries no hosted-only code", () => {
    const js = built()
      .filter((path) => path.endsWith(".js"))
      .map(read)
      .join("\n");
    expect(js.length).toBeGreaterThan(0);
    for (const needle of ["supabase", "next/navigation", "/auth/sign-out"]) expect(js, needle).not.toContain(needle);
  });
});
