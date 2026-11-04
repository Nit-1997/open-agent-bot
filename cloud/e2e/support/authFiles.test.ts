import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { clearAuthDir, deletedCount, lockFile, prepareAuthDir } from "./authFiles.ts";

const WORK = mkdtempSync(join(tmpdir(), "auth-files-"));
after(() => rmSync(WORK, { recursive: true, force: true }));
const mode = (p: string) => statSync(p).mode & 0o777;

describe("auth state files", () => {
  it("prepareAuthDir makes the folder 0700, also when it exists with a wider mode", () => {
    const fresh = join(WORK, "fresh", ".auth");
    prepareAuthDir(fresh);
    assert.equal(mode(fresh), 0o700);
    const wide = join(WORK, "wide");
    mkdirSync(wide, { mode: 0o755 });
    prepareAuthDir(wide);
    assert.equal(mode(wide), 0o700);
  });

  it("lockFile makes a storage state file 0600", () => {
    const f = join(WORK, "state.json");
    writeFileSync(f, "{}", { mode: 0o644 });
    lockFile(f);
    assert.equal(mode(f), 0o600);
  });

  it("clearAuthDir removes the files in the folder and returns how many", () => {
    const dir = join(WORK, "clear");
    prepareAuthDir(dir);
    writeFileSync(join(dir, "a.json"), "{}");
    writeFileSync(join(dir, "b.json"), "{}");
    assert.equal(clearAuthDir(dir), 2);
    assert.deepEqual(readdirSync(dir), []);
    assert.equal(clearAuthDir(join(WORK, "missing")), 0);
    assert.equal(existsSync(join(WORK, "missing")), false);
  });

  it("deletedCount counts the cleanup script's deleted lines", () => {
    assert.equal(deletedCount("deleted 1\ndeleted 2\nremaining users: 4\n"), 2);
    assert.equal(deletedCount("remaining users: 4\n"), 0);
  });
});
