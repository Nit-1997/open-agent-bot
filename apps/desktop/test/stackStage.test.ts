import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageStack } from "../src/main/stackFiles.ts";

let root: string;
let bundled: string;
let user: string;
let staged: string;
const mode = (p: string) => statSync(p).mode & 0o777;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "oab-stage-rt-"));
  bundled = join(root, "Resources/stack");
  mkdirSync(join(bundled, "local/renderer"), { recursive: true });
  writeFileSync(join(bundled, "docker-compose.yml"), "name: open-agent\n");
  writeFileSync(join(bundled, "local/renderer/seccomp.json"), "{}\n");
  user = join(root, "userData");
  mkdirSync(user, { mode: 0o700 });
  staged = join(user, "stack");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runtime staging (D12)", () => {
  it("first stage: same bytes, 0700 dirs, 0600 files, stack.sha256", () => {
    const r = stageStack({ bundledDir: bundled, stagedDir: staged });
    expect(r.restaged).toBe(true);
    expect(readFileSync(join(staged, "docker-compose.yml"), "utf8")).toBe("name: open-agent\n");
    expect(readFileSync(join(staged, "local/renderer/seccomp.json"), "utf8")).toBe("{}\n");
    expect([staged, join(staged, "local"), join(staged, "local/renderer")].map(mode)).toEqual([0o700, 0o700, 0o700]);
    expect(["docker-compose.yml", "local/renderer/seccomp.json", "stack.sha256"].map((f) => mode(join(staged, f)))).toEqual([
      0o600, 0o600, 0o600,
    ]);
    expect(readFileSync(join(staged, "stack.sha256"), "utf8")).toMatch(
      /^[0-9a-f]{64} {2}docker-compose\.yml\n[0-9a-f]{64} {2}local\/renderer\/seccomp\.json\n$/,
    );
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("no-op on the same hash", () => {
    stageStack({ bundledDir: bundled, stagedDir: staged });
    expect(stageStack({ bundledDir: bundled, stagedDir: staged }).restaged).toBe(false);
  });

  it("restages when the bundled file changes (an app update)", () => {
    stageStack({ bundledDir: bundled, stagedDir: staged });
    writeFileSync(join(bundled, "docker-compose.yml"), "name: open-agent\n# v2\n");
    expect(stageStack({ bundledDir: bundled, stagedDir: staged })).toMatchObject({ restaged: true, reason: "hash_changed" });
    expect(readFileSync(join(staged, "docker-compose.yml"), "utf8")).toContain("# v2");
  });

  it.each([
    ["content", () => writeFileSync(join(staged, "docker-compose.yml"), "evil\n"), "content docker-compose.yml"],
    ["mode", () => chmodSync(join(staged, "local/renderer/seccomp.json"), 0o644), "file local/renderer/seccomp.json"],
    [
      "symlink",
      () => {
        rmSync(join(staged, "docker-compose.yml"));
        symlinkSync(join(bundled, "docker-compose.yml"), join(staged, "docker-compose.yml"));
      },
      "file docker-compose.yml",
    ],
  ])("restages a tampered staged file (%s)", (_n, tamper, reason) => {
    stageStack({ bundledDir: bundled, stagedDir: staged });
    tamper();
    expect(stageStack({ bundledDir: bundled, stagedDir: staged })).toMatchObject({ restaged: true, reason });
    expect(lstatSync(join(staged, "docker-compose.yml")).isFile()).toBe(true);
    expect(readFileSync(join(staged, "docker-compose.yml"), "utf8")).toBe("name: open-agent\n");
  });

  it("userData/stack replaced by a symlink to another dir is moved aside and restaged; the target is untouched", () => {
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere, { mode: 0o700 });
    writeFileSync(join(elsewhere, "docker-compose.yml"), "theirs\n");
    symlinkSync(elsewhere, staged);
    expect(stageStack({ bundledDir: bundled, stagedDir: staged })).toMatchObject({ restaged: true, reason: "stack_dir" });
    expect(lstatSync(staged).isDirectory()).toBe(true);
    expect(lstatSync(staged).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(elsewhere, "docker-compose.yml"), "utf8")).toBe("theirs\n");
  });

  it("a wide userData/stack dir is restaged", () => {
    stageStack({ bundledDir: bundled, stagedDir: staged });
    chmodSync(staged, 0o755);
    expect(stageStack({ bundledDir: bundled, stagedDir: staged })).toMatchObject({ restaged: true, reason: "stack_dir" });
    expect(mode(staged)).toBe(0o700);
  });

  it("cleans leftover stack.tmp-* and stack.old-* and swaps in the order aside → in → remove", () => {
    stageStack({ bundledDir: bundled, stagedDir: staged });
    mkdirSync(join(user, "stack.tmp-abc"));
    mkdirSync(join(user, "stack.old-def"));
    writeFileSync(join(staged, "docker-compose.yml"), "tampered\n");
    const ops: string[] = [];
    stageStack({ bundledDir: bundled, stagedDir: staged, trace: (op) => ops.push(op) });
    expect(ops).toEqual(
      ["clean stack.old-def", "clean stack.tmp-abc", "write tmp", "aside", "in", "remove"].sort((a, b) =>
        a.startsWith("clean") && b.startsWith("clean") ? a.localeCompare(b) : 0,
      ),
    );
    expect(readdirSync(user).sort()).toEqual(["stack"]);
    expect(existsSync(join(staged, "stack.sha256"))).toBe(true);
  });
});
