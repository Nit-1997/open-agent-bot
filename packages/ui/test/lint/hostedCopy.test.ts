import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");

const HOSTED = [/requests used/i, /Run it on your Mac/i, /Run Open Agent on your own Mac/i, /releases\/latest/, /One quick check/i, /github\.com\/Nit-1997/i];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? sources(path) : [path];
  });
}

describe("hosted usage copy stays out of the shared ui", () => {
  it("packages/ui/src holds none of the hosted usage strings or links", () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return HOSTED.filter((re) => re.test(text)).map((re) => `${relative(ROOT, file)}: ${re}`);
    });
    expect(hits).toEqual([]);
  });
});
