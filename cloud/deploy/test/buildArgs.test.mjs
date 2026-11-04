import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCKERFILES = ["cloud/web/Dockerfile", "cloud/agent/Dockerfile"];

const instructions = (text) =>
  text
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

const declared = (lines) =>
  lines.flatMap((l) => {
    const arg = /^ARG\s+(\w+)/i.exec(l);
    if (arg) return [arg[1]];
    const env = /^ENV\s+(.*)$/i.exec(l);
    return env ? [...env[1].matchAll(/(\w+)=/g)].map((m) => m[1]) : [];
  });

describe("hosted Dockerfiles keep build arg values out of the build log", () => {
  for (const file of DOCKERFILES)
    it(`${file}: no RUN command line names an ARG or ENV variable (BuildKit prints RUN lines with them expanded)`, () => {
      const lines = instructions(readFileSync(join(ROOT, file), "utf8"));
      const names = declared(lines);
      const leaks = lines
        .filter((l) => /^RUN\s/i.test(l))
        .flatMap((l) => names.filter((n) => new RegExp(`\\$\\{?${n}\\b`).test(l)).map((n) => `${n} in: ${l.slice(0, 60)}`));
      assert.deepEqual(leaks, []);
    });
});
