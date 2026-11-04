import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importSpecifiers } from "../../../apps/desktop/test/support/boundary.ts";

const WEB = resolve(import.meta.dirname, "..");
const SELF = resolve(import.meta.filename);

const files = (dir: string): string[] =>
  (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "dist" || e.name === ".next" ? [] : files(p);
    return /\.(ts|tsx|mts|js|mjs)$/.test(e.name) ? [p] : [];
  });

describe("B11 import boundary (hosted web app)", () => {
  it("nothing in cloud/web imports the desktop app", () => {
    const all = files(WEB).filter((f) => f !== SELF);
    expect(all.length).toBeGreaterThan(50);
    const hits = all.filter((f) =>
      importSpecifiers(readFileSync(f, "utf8")).some((s) => s.startsWith("@oab/desktop") || /(^|\/)apps\/desktop(\/|$)/.test(s)),
    );
    expect(hits.map((f) => relative(WEB, f))).toEqual([]);
  });
});
