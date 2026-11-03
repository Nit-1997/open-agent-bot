import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createZipWriter, ZipTooLargeError } from "../../src/local/zipStream.js";
import { readZip } from "./zipReader.js";

const collect = () => {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  return { out, bytes: () => Buffer.concat(chunks) };
};

const NOW = () => new Date("2026-11-03T10:20:30Z");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const hasUnzip = spawnSync("unzip", ["-v"], { encoding: "utf8" }).status === 0;

describe("zipStream", () => {
  it("writes deflated entries with data descriptors that an in-test central-directory reader round-trips", async () => {
    const { out, bytes } = collect();
    const zip = createZipWriter(out, { now: NOW });
    const big = Buffer.from("chunk of a database page ".repeat(20000));
    await zip.addBuffer("export.json", Buffer.from('{"app":"open-agent"}'));
    await zip.addStream("open-agent.db", Readable.from([big.subarray(0, 100_000), big.subarray(100_000)]));
    await zip.addBuffer("reports/u/AbCdEfGhIjKl.html", Buffer.from("<p>report</p>"));
    const done = await zip.finish();
    const buf = bytes();
    expect(done).toEqual({ entries: 3, bytes: buf.length });
    const entries = readZip(buf);
    expect(entries.map((e) => e.name)).toEqual(["export.json", "open-agent.db", "reports/u/AbCdEfGhIjKl.html"]);
    expect(entries.every((e) => e.method === 8 && (e.flags & 0x08) === 0x08)).toBe(true);
    expect(entries[1]?.data.equals(big)).toBe(true);
    expect(entries[1]?.crc).toBe(crc32(big));
    expect(entries[0]?.data.toString()).toBe('{"app":"open-agent"}');
    expect(buf.length).toBeLessThan(big.length);
  });

  it.skipIf(!hasUnzip)("passes unzip -t and lists the same names with unzip -l", async () => {
    const { out, bytes } = collect();
    const zip = createZipWriter(out, { now: NOW });
    await zip.addBuffer("export.json", Buffer.from("{}"));
    await zip.addStream("open-agent.db", Readable.from([Buffer.alloc(70_000, 7)]));
    await zip.finish();
    const dir = mkdtempSync(join(tmpdir(), "oab-zip-"));
    dirs.push(dir);
    const file = join(dir, "t.zip");
    writeFileSync(file, bytes());
    const test = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
    expect(test.status, test.stdout + test.stderr).toBe(0);
    expect(test.stdout).toContain("No errors detected");
    const list = spawnSync("unzip", ["-l", file], { encoding: "utf8" });
    expect(list.stdout).toContain("export.json");
    expect(list.stdout).toContain("open-agent.db");
  });

  it("refuses names that are absolute, climb out or carry backslashes", async () => {
    const zip = createZipWriter(collect().out, { now: NOW });
    for (const bad of ["/etc/passwd", "../x", "a/../../b", "a\\b", ""]) {
      await expect(zip.addBuffer(bad, Buffer.from("x"))).rejects.toThrow(/entry name/);
    }
  });

  it("the byte limit → ZipTooLargeError and no end of central directory is ever written", async () => {
    const { out, bytes } = collect();
    const zip = createZipWriter(out, { now: NOW, limits: { maxBytes: 4096 } });
    await zip.addBuffer("a", Buffer.from("small"));
    await expect(zip.addStream("b", Readable.from([randomBytes(20_000)]))).rejects.toBeInstanceOf(ZipTooLargeError);
    await expect(zip.finish()).rejects.toBeInstanceOf(ZipTooLargeError);
    expect(() => readZip(bytes())).toThrow(/no end of central directory/);
  });

  it("the entry limit → ZipTooLargeError before the extra entry is written", async () => {
    const zip = createZipWriter(collect().out, { now: NOW, limits: { maxEntries: 2 } });
    await zip.addBuffer("a", Buffer.from("1"));
    await zip.addBuffer("b", Buffer.from("2"));
    await expect(zip.addBuffer("c", Buffer.from("3"))).rejects.toBeInstanceOf(ZipTooLargeError);
  });

  it("an output error rejects the write instead of finishing a truncated file", async () => {
    const out = new PassThrough();
    const zip = createZipWriter(out, { now: NOW });
    await zip.addBuffer("a", Buffer.from("1"));
    out.destroy(Object.assign(new Error("write ENOSPC"), { code: "ENOSPC" }));
    await expect(zip.addBuffer("b", Buffer.from("2"))).rejects.toThrow(/ENOSPC/);
  });
});
