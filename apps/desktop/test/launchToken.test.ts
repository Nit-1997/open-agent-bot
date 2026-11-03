import { mkdtempSync, rmSync, statSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadStackToken, newLaunchToken, tokenFingerprint, tokensEqual } from "../src/main/launchToken.ts";

describe("launch token", () => {
  it("is 64 lowercase hex", () => {
    expect(newLaunchToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is distinct across 1000 calls", () => {
    const seen = new Set(Array.from({ length: 1000 }, newLaunchToken));
    expect(seen.size).toBe(1000);
  });

  it("has a 12-hex sha256 fingerprint", () => {
    const fp = tokenFingerprint("a".repeat(64));
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(fp).toBe("ffe054fe7ae0");
    expect(tokenFingerprint("b".repeat(64))).not.toBe(fp);
  });

  it("compares tokens without short-circuiting on undefined or length", () => {
    const t = newLaunchToken();
    expect(tokensEqual(t, `${t}`)).toBe(true);
    expect(tokensEqual(t, newLaunchToken())).toBe(false);
    expect(tokensEqual(t, t.slice(1))).toBe(false);
    expect(tokensEqual(undefined, t)).toBe(false);
    expect(tokensEqual(t, undefined)).toBe(false);
    expect(tokensEqual(undefined, undefined)).toBe(false);
    expect(tokensEqual("", "")).toBe(false);
  });
});

describe("loadStackToken", () => {
  let dir: string;
  const warnings: string[] = [];
  const log = { info: () => {}, warn: (m: string) => warnings.push(m), error: () => {} };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "oab-token-"));
    warnings.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates stack.json 0600 with a new token, then reuses it", () => {
    const file = join(dir, "stack.json");
    const first = loadStackToken(file, { project: "oab-x", port: 18420 }, log);
    expect(first.created).toBe(true);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved).toMatchObject({ schema: 1, project: "oab-x", port: 18420, launchToken: first.token });
    expect(typeof saved.tokenCreatedAt).toBe("string");
    const second = loadStackToken(file, { project: "oab-x", port: 18420 }, log);
    expect(second).toEqual({ token: first.token, created: false });
    expect(warnings).toEqual([]);
  });

  it("discards a token in a wide-mode file, warns and rotates", () => {
    const file = join(dir, "stack.json");
    const first = loadStackToken(file, { project: "oab-x", port: 18420 }, log);
    chmodSync(file, 0o644);
    const next = loadStackToken(file, { project: "oab-x", port: 18420 }, log);
    expect(next.created).toBe(true);
    expect(next.token).not.toBe(first.token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(warnings.join("\n")).toMatch(/\[state\] stack\.json wide_mode/);
    expect(warnings.join("\n")).not.toContain(first.token);
  });

  it("rotates on malformed content or a token that isn't 64 hex", () => {
    const file = join(dir, "stack.json");
    writeFileSync(file, JSON.stringify({ schema: 1, project: "oab-x", port: 18420, launchToken: "short" }), { mode: 0o600 });
    const next = loadStackToken(file, { project: "oab-x", port: 18420 }, log);
    expect(next.created).toBe(true);
    expect(next.token).toMatch(/^[0-9a-f]{64}$/);
    expect(warnings.join("\n")).toMatch(/malformed/);
  });
});
