import {
  chmodSync,
  chownSync,
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
import { loadShellConfig } from "../src/main/shellConfig.ts";
import { ensurePrivateDir, readStateFile, resolvePaths, writeStateFile } from "../src/main/statePaths.ts";

const mode = (p: string) => statSync(p).mode & 0o777;
const asObject = (v: unknown) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oab-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("resolvePaths", () => {
  it("puts every file under userData and logs in production", () => {
    const cfg = loadShellConfig({}, { realUserData: "/u/Open Agent", realLogs: "/l/Open Agent" });
    const p = resolvePaths(cfg, { userData: "/u/Open Agent", logs: "/l/Open Agent" });
    expect(p).toEqual({
      stateDir: "/u/Open Agent",
      userData: "/u/Open Agent",
      logsDir: "/l/Open Agent",
      stackFile: "/u/Open Agent/stack.json",
      settingsFile: "/u/Open Agent/settings.json",
      servicesFile: "/u/Open Agent/services.json",
      statusFile: "/u/Open Agent/status.json",
    });
  });

  it("puts everything under the state dir in test mode", () => {
    const cfg = loadShellConfig(
      {
        OPEN_AGENT_SHELL_TEST: "1",
        OPEN_AGENT_SHELL_STATE_DIR: "/t/state",
        OPEN_AGENT_SHELL_PROJECT: "oab-x",
        OPEN_AGENT_SHELL_DATA_VOLUME: "oab-x-data",
        OPEN_AGENT_SHELL_KEYS_VOLUME: "oab-x-keys",
        OPEN_AGENT_SHELL_PORT_RANGE: "18420-18421",
      },
      { realUserData: "/u/Open Agent", realLogs: "/l/Open Agent" },
    );
    const p = resolvePaths(cfg, { userData: "/t/state/electron", logs: "/t/state/logs" });
    expect(p.stateDir).toBe("/t/state");
    expect(p.userData).toBe("/t/state/electron");
    expect(p.logsDir).toBe("/t/state/logs");
    expect(p.stackFile).toBe("/t/state/stack.json");
  });
});

describe("ensurePrivateDir", () => {
  it("creates a 0700 directory and narrows a wide one", () => {
    const d = join(dir, "a/b");
    ensurePrivateDir(d);
    expect(mode(d)).toBe(0o700);
    chmodSync(d, 0o755);
    ensurePrivateDir(d);
    expect(mode(d)).toBe(0o700);
  });

  it("refuses a symlinked directory", () => {
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    expect(() => ensurePrivateDir(join(dir, "link"))).toThrow(/symlink|directory/);
  });

  it("refuses a regular file", () => {
    writeFileSync(join(dir, "file"), "x");
    expect(() => ensurePrivateDir(join(dir, "file"))).toThrow(/directory/);
  });
});

describe("writeStateFile", () => {
  it("writes 0600 JSON in a 0700 dir, atomically, with no temp files left", () => {
    const f = join(dir, "s/stack.json");
    writeStateFile(f, { schema: 1, port: 18420 });
    expect(mode(f)).toBe(0o600);
    expect(mode(join(dir, "s"))).toBe(0o700);
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ schema: 1, port: 18420 });
    writeStateFile(f, { schema: 1, port: 18421 });
    expect(JSON.parse(readFileSync(f, "utf8"))).toEqual({ schema: 1, port: 18421 });
    expect(readdirSync(join(dir, "s"))).toEqual(["stack.json"]);
  });

  it("replaces a wide-mode file with a 0600 one", () => {
    const f = join(dir, "settings.json");
    writeFileSync(f, "{}", { mode: 0o644 });
    chmodSync(f, 0o644);
    writeStateFile(f, { schema: 1 });
    expect(mode(f)).toBe(0o600);
  });

  it("replaces a symlink with a regular file and leaves the target alone", () => {
    const target = join(dir, "target.json");
    writeFileSync(target, "untouched");
    symlinkSync(target, join(dir, "stack.json"));
    writeStateFile(join(dir, "stack.json"), { schema: 1 });
    expect(lstatSync(join(dir, "stack.json")).isSymbolicLink()).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("untouched");
  });
});

describe("readStateFile", () => {
  it("reads a valid file", () => {
    const f = join(dir, "stack.json");
    writeStateFile(f, { schema: 1 });
    expect(readStateFile(f, asObject)).toEqual({ value: { schema: 1 } });
  });

  it("reports missing", () => {
    expect(readStateFile(join(dir, "none.json"), asObject)).toEqual({ problem: "missing" });
  });

  it("reports a symlink and never follows it", () => {
    const target = join(dir, "target.json");
    writeStateFile(target, { schema: 1 });
    symlinkSync(target, join(dir, "stack.json"));
    expect(readStateFile(join(dir, "stack.json"), asObject)).toEqual({ problem: "symlink" });
  });

  it("reports a directory as not regular", () => {
    mkdirSync(join(dir, "stack.json"), { mode: 0o700 });
    expect(readStateFile(join(dir, "stack.json"), asObject)).toEqual({ problem: "not_regular" });
  });

  it("reports a group- or other-accessible file as wide_mode", () => {
    const f = join(dir, "stack.json");
    writeStateFile(f, { schema: 1 });
    for (const m of [0o644, 0o640, 0o604, 0o660, 0o606]) {
      chmodSync(f, m);
      expect(readStateFile(f, asObject)).toEqual({ problem: "wide_mode" });
    }
  });

  it("reports malformed JSON and a value the parser rejects", () => {
    const f = join(dir, "stack.json");
    writeFileSync(f, "{not json", { mode: 0o600 });
    expect(readStateFile(f, asObject)).toEqual({ problem: "malformed" });
    writeFileSync(f, "[1,2]", { mode: 0o600 });
    expect(readStateFile(f, asObject)).toEqual({ problem: "malformed" });
  });

  it.skipIf(!isRoot)("reports a file owned by another user as foreign_owner", () => {
    const f = join(dir, "stack.json");
    writeStateFile(f, { schema: 1 });
    chownSync(f, 501 === process.getuid?.() ? 502 : 501, 20);
    expect(readStateFile(f, asObject)).toEqual({ problem: "foreign_owner" });
  });
});
