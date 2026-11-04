import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserError } from "../../src/lib/errors.js";
import { reportFiles, reportPath } from "../../src/local/store/files.js";
import { artifactId } from "../contract/store.js";
import { tempDir } from "./storeHarness.js";

const mode = (p: string) => statSync(p).mode & 0o777;

describe("reports folder storage", () => {
  let tmp: ReturnType<typeof tempDir>;
  let reports: string;
  let userId: string;

  beforeEach(() => {
    tmp = tempDir("oab-files-");
    reports = join(tmp.dir, "reports");
    userId = randomUUID();
  });
  afterEach(() => tmp.dispose());

  it("creates directories 0700 and files 0600", async () => {
    const files = reportFiles(reports, userId);
    const id = artifactId();
    for (const file of ["html", "pdf", "jpg"] as const) await files.upload(id, file, Buffer.from(file));
    expect(mode(reports)).toBe(0o700);
    expect(mode(join(reports, userId))).toBe(0o700);
    for (const file of ["html", "pdf", "jpg"]) expect(mode(join(reports, userId, `${id}.${file}`))).toBe(0o600);
  });

  it("lets exactly one of two concurrent html uploads win", async () => {
    const files = reportFiles(reports, userId);
    for (let round = 0; round < 20; round++) {
      const id = artifactId();
      const a = Buffer.from(`<p>a${round}</p>`);
      const b = Buffer.from(`<p>b${round}</p>`);
      const results = await Promise.allSettled([files.upload(id, "html", a), files.upload(id, "html", b)]);
      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect(lost[0]).toBeInstanceOf(UserError);
      expect(lost[0]).toMatchObject({ kind: "upstream" });
      const stored = await files.download(id, "html");
      expect(stored?.equals(a) || stored?.equals(b)).toBe(true);
    }
    expect(readdirSync(join(reports, userId)).every((f) => /^[A-Za-z0-9_-]{12}\.html$/.test(f))).toBe(true);
  });

  it("replaces pdf and jpg atomically: a reader never sees a partial file", async () => {
    const files = reportFiles(reports, userId);
    const id = artifactId();
    const a = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const b = Buffer.alloc(3 * 1024 * 1024, 0x62);
    await files.upload(id, "pdf", a);
    const writes = Array.from({ length: 10 }, (_, i) => files.upload(id, "pdf", i % 2 ? a : b));
    const reads = Array.from({ length: 30 }, () => files.download(id, "pdf"));
    await Promise.all(writes);
    for (const got of await Promise.all(reads)) expect(got?.equals(a) || got?.equals(b)).toBe(true);
  });

  it("leaves no temp file after a failed write", async () => {
    const files = reportFiles(reports, userId);
    const id = artifactId();
    await files.upload(id, "html", Buffer.from("<p>first</p>"));
    await expect(files.upload(id, "html", Buffer.from("<p>second</p>"))).rejects.toMatchObject({ kind: "upstream" });
    const blocked = artifactId();
    mkdirSync(join(reports, userId, `${blocked}.pdf`));
    await expect(files.upload(blocked, "pdf", Buffer.from("%PDF"))).rejects.toBeInstanceOf(UserError);
    expect(readdirSync(join(reports, userId)).sort()).toEqual([`${blocked}.pdf`, `${id}.html`].sort());
  });

  it("downloads a missing file as undefined and removes a missing file without error", async () => {
    const files = reportFiles(reports, userId);
    expect(await files.download(artifactId(), "jpg")).toBeUndefined();
    await expect(files.remove(artifactId(), "jpg")).resolves.toBeUndefined();
  });

  it("rejects an invalid id before touching the disk", async () => {
    const files = reportFiles(reports, userId);
    for (const bad of ["../../etc", "a/b", "", "..", `../${randomUUID()}/${artifactId()}`]) {
      await expect(files.upload(bad, "html", Buffer.from("x"))).rejects.toMatchObject({ kind: "not_found" });
      await expect(files.download(bad, "html")).rejects.toMatchObject({ kind: "not_found" });
      await expect(files.remove(bad, "html")).rejects.toMatchObject({ kind: "not_found" });
    }
    expect(() => statSync(reports)).toThrow();
  });

  it("never builds a path outside reports/<userId>/ from a validated id", () => {
    const ids = ["------------", "____________", "-_-_-_-_-_-_", "AAAAAAAAAAAA", ...Array.from({ length: 200 }, artifactId)];
    for (const id of ids)
      for (const file of ["html", "pdf", "jpg"] as const) {
        const p = reportPath(reports, userId, id, file);
        expect(dirname(resolve(p))).toBe(resolve(reports, userId));
        expect(p.endsWith(`${id}.${file}`)).toBe(true);
      }
    expect(() => reportPath(reports, userId, "../x/abcdefgh", "pdf")).toThrow(UserError);
    expect(() => reportPath(reports, "../other", "abcdefghijkl", "pdf")).toThrow();
  });
});
