import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readEnvFile } from "../../evals/auth/hosted.js";

describe("helpers", () => {
  it("reads KEY=value env files, ignoring comments and blank lines, and tolerates a missing file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "env-")), ".env-x");
    writeFileSync(file, "# comment\nA=1\n\nB=x=y\n");
    expect(readEnvFile(file)).toEqual({ A: "1", B: "x=y" });
    expect(readEnvFile(`${file}-missing`)).toEqual({});
  });
});
