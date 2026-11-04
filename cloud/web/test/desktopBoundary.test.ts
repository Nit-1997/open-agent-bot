import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const { importSpecifiers }: { importSpecifiers: (text: string) => string[] } = await import(
  pathToFileURL(join(import.meta.dirname, "../../../apps/desktop/test/support/boundary.ts")).href
);
const WEB = resolve(import.meta.dirname, "..");

const files = (dir: string): string[] =>
  (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" || e.name === ".next" ? [] : files(p);
    return /\.(ts|tsx|mts|js|mjs)$/.test(e.name) ? [p] : [];
  });

describe("B11 import boundary (hosted web app)", () => {
  it("nothing in cloud/web imports the desktop app", () => {
    const all = files(WEB);
    expect(all.length).toBeGreaterThan(50);
    const hits = all.filter((f) =>
      importSpecifiers(readFileSync(f, "utf8")).some((s) => s.startsWith("@oab/desktop") || /(^|\/)apps\/desktop(\/|$)/.test(s)),
    );
    expect(hits.map((f) => relative(WEB, f))).toEqual([]);
  });
});
