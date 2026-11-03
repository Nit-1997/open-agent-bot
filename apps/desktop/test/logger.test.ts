import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/main/logger.ts";

const mode = (p: string) => statSync(p).mode & 0o777;

describe("logger", () => {
  let dir: string;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "oab-log-")), "logs");
  });
  afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

  it("writes shell.log 0600 in a 0700 dir with level and timestamp", () => {
    const log = createLogger({ dir, tokens: () => [], now: () => new Date("2026-11-03T10:00:00.000Z") });
    log.info("[app] ready");
    log.warn("[state] stack.json wide_mode");
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, "shell.log"))).toBe(0o600);
    expect(readFileSync(join(dir, "shell.log"), "utf8")).toBe(
      "2026-11-03T10:00:00.000Z info [app] ready\n2026-11-03T10:00:00.000Z warn [state] stack.json wide_mode\n",
    );
  });

  it("redacts the current and previous token from every line", () => {
    const tokens = ["d".repeat(64), "e".repeat(64)];
    const log = createLogger({ dir, tokens: () => tokens });
    log.error(`[docker] stderr ${tokens[0]} and ${tokens[1]}`);
    const text = readFileSync(join(dir, "shell.log"), "utf8");
    expect(text).toContain("[docker] stderr [token] and [token]");
    expect(text).not.toContain(tokens[0]);
  });

  it("keeps one line per call, with newlines and control characters escaped", () => {
    const log = createLogger({ dir, tokens: () => [] });
    log.info("a\nb\r\u0007c");
    expect(readFileSync(join(dir, "shell.log"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(join(dir, "shell.log"), "utf8")).toContain("a\\nb\\r\\u0007c");
  });

  it("rotates at the size limit and keeps 3 files, all 0600", () => {
    const log = createLogger({ dir, tokens: () => [], maxBytes: 200, keep: 3 });
    for (let i = 0; i < 40; i++) log.info(`line ${i} ${"x".repeat(40)}`);
    const names = readdirSync(dir).sort();
    expect(names).toEqual(["shell.log", "shell.log.1", "shell.log.2", "shell.log.3"]);
    for (const n of names) expect(mode(join(dir, n))).toBe(0o600);
    for (const n of names) expect(statSync(join(dir, n)).size).toBeLessThanOrEqual(200);
    expect(readFileSync(join(dir, "shell.log"), "utf8")).toContain("line 39");
  });

  it("narrows an existing wide log file and dir", () => {
    const first = createLogger({ dir, tokens: () => [] });
    first.info("x");
    chmodSync(join(dir, "shell.log"), 0o644);
    chmodSync(dir, 0o755);
    createLogger({ dir, tokens: () => [] }).info("y");
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, "shell.log"))).toBe(0o600);
  });

  it("refuses to write through a symlinked log file", () => {
    const log = createLogger({ dir, tokens: () => [] });
    log.info("x");
    rmSync(join(dir, "shell.log"));
    const target = join(dir, "..", "target.txt");
    writeFileSync(target, "untouched");
    symlinkSync(target, join(dir, "shell.log"));
    createLogger({ dir, tokens: () => [] }).info("y");
    expect(readFileSync(target, "utf8")).toBe("untouched");
  });
});
