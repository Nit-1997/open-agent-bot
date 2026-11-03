import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(APP, "../..");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const stage = (args: string[]) =>
  spawnSync(process.execPath, [join(APP, "scripts/stage-stack.mjs"), ...args], { cwd: APP, encoding: "utf8" });

describe("stage-stack (D12)", () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), "oab-stage-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it("stages the root compose file and seccomp profile byte for byte, plus the lock, and nothing else", () => {
    const run = stage(["--out", out]);
    expect(run.status, run.stderr).toBe(0);
    expect(
      walk(out)
        .map((p) => relative(out, p))
        .sort(),
    ).toEqual(["docker-compose.yml", "local/renderer/seccomp.json", "services.lock.json"]);
    expect(readFileSync(join(out, "docker-compose.yml"))).toEqual(readFileSync(join(REPO, "docker-compose.yml")));
    expect(readFileSync(join(out, "local/renderer/seccomp.json"))).toEqual(readFileSync(join(REPO, "local/renderer/seccomp.json")));
    expect(readFileSync(join(out, "services.lock.json"))).toEqual(readFileSync(join(APP, "services.lock.json")));
  });

  it("the committed lock template is the dev template and pins the root compose file's SHA-256", () => {
    const lock = JSON.parse(readFileSync(join(APP, "services.lock.json"), "utf8"));
    expect(lock).toEqual({ schema: 1, version: "dev", composeSha256: sha(join(REPO, "docker-compose.yml")), images: null });
  });

  it("refuses a lock whose composeSha256 doesn't match", () => {
    const bad = join(out, "bad.lock.json");
    writeFileSync(bad, JSON.stringify({ schema: 1, version: "dev", composeSha256: "0".repeat(64), images: null }));
    const run = stage(["--out", join(out, "stack"), "--lock", bad]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/composeSha256/);
  });

  it("restages over its own files but refuses a folder holding anything else", () => {
    expect(stage(["--out", out]).status).toBe(0);
    expect(stage(["--out", out]).status).toBe(0);
    writeFileSync(join(out, ".env"), "SECRET=1");
    const run = stage(["--out", out]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/unexpected file .env/);
  });
});
