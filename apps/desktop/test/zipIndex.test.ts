import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractEntry, readZipIndex, ZipIndexError } from "../src/main/zipIndex.ts";
import { buildZip } from "./fake-docker/zip.mjs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oab-zipidx-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, bytes: Buffer) => {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
};

describe("zipIndex", () => {
  it("reads every central-directory name, size and offset", () => {
    const db = Buffer.alloc(200_000, 3);
    const p = write(
      "a.zip",
      buildZip([
        { name: "export.json", data: Buffer.from("{}") },
        { name: "open-agent.db", data: db },
        { name: "reports/u/AbCdEfGhIjKl.html", data: Buffer.from("<p>r</p>") },
      ]),
    );
    const idx = readZipIndex(p);
    expect(idx.map((e) => e.name)).toEqual(["export.json", "open-agent.db", "reports/u/AbCdEfGhIjKl.html"]);
    expect(idx[1]).toMatchObject({ size: 200_000, method: 8 });
  });

  it("extracts one entry to a 0600 file and checks its CRC", async () => {
    const db = Buffer.from("SQLite format 3\0 and some pages ".repeat(3000));
    const p = write("a.zip", buildZip([{ name: "open-agent.db", data: db }]));
    const entry = readZipIndex(p)[0];
    if (!entry) throw new Error("no entry");
    const out = join(dir, "out.db");
    await extractEntry(p, entry, out);
    expect(readFileSync(out).equals(db)).toBe(true);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    await expect(extractEntry(p, { ...entry, crc: (entry.crc + 1) >>> 0 }, join(dir, "bad.db"))).rejects.toThrow(/crc/i);
  });

  it("a file that is not a zip, or a truncated one, is refused explicitly", () => {
    expect(() => readZipIndex(write("x.zip", Buffer.from("not a zip at all")))).toThrow(ZipIndexError);
    const full = buildZip([{ name: "export.json", data: Buffer.from("{}") }]);
    expect(() => readZipIndex(write("t.zip", full.subarray(0, full.length - 30)))).toThrow(ZipIndexError);
  });

  it("a central directory pointing outside the file is refused", () => {
    const full = buildZip([{ name: "export.json", data: Buffer.from("{}") }]);
    full.writeUInt32LE(0xfffffff0, full.length - 6);
    expect(() => readZipIndex(write("o.zip", full))).toThrow(ZipIndexError);
  });
});
