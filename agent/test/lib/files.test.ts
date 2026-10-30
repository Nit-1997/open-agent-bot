import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonFile, writeFileAtomic } from "../../src/lib/files.js";

const dir = () => mkdtempSync(join(tmpdir(), "files-"));

describe("writeFileAtomic", () => {
  it("replaces the file owner-only and leaves no temp files behind", async () => {
    const d = dir();
    const path = join(d, "a.json");
    writeFileSync(path, "old");
    await writeFileAtomic(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(d)).toEqual(["a.json"]);
  });

  it("cleans up the temp file when the write fails", async () => {
    const d = dir();
    await expect(writeFileAtomic(join(d, "missing", "a.json"), "x")).rejects.toThrow();
    expect(readdirSync(d)).toEqual([]);
  });
});

describe("readJsonFile", () => {
  it("returns undefined for a missing file and the value for valid JSON", async () => {
    const d = dir();
    expect(await readJsonFile(join(d, "none.json"))).toBeUndefined();
    writeFileSync(join(d, "ok.json"), '{"a":1}');
    expect(await readJsonFile(join(d, "ok.json"))).toEqual({ a: 1 });
  });

  it("refuses a corrupt file instead of treating it as empty", async () => {
    const d = dir();
    writeFileSync(join(d, "bad.json"), '{"a":');
    await expect(readJsonFile(join(d, "bad.json"))).rejects.toThrow(/bad\.json is not valid JSON/);
  });
});
