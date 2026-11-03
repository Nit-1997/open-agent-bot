import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseHexSecret, readSecretFile, SecretFileError } from "../../src/lib/secretFile.js";
import { REFUSAL_EXIT, refusalOf } from "../../src/local/refusal.js";

const HEX = "a".repeat(64);
let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "oa-secret-file-")));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (path: string) => readSecretFile({ path, parse: parseHexSecret, label: "renderer secret" });

describe("readSecretFile", () => {
  it("reads a 0600 hex secret", () => {
    writeFileSync(join(dir, "secret"), `${HEX}\n`, { mode: 0o600 });
    expect(read(join(dir, "secret"))).toBe(HEX);
  });

  it.each([
    ["missing", () => undefined, /does not exist/],
    ["open to others", (p: string) => writeFileSync(p, HEX, { mode: 0o644 }), /open to group or others/],
    ["malformed", (p: string) => writeFileSync(p, "nope", { mode: 0o600 }), /malformed/],
    [
      "a symlink",
      (p: string) => {
        writeFileSync(join(dir, "real"), HEX, { mode: 0o600 });
        symlinkSync(join(dir, "real"), p);
      },
      /symlink/,
    ],
    ["a directory", (p: string) => mkdirSync(p, { mode: 0o700 }), /not a regular file/],
  ])("refuses a file that is %s with a plain SecretFileError", (_name, setup, message) => {
    const path = join(dir, "secret");
    setup(path);
    let caught: unknown;
    try {
      read(path);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SecretFileError);
    expect((caught as SecretFileError).code).toBe("keyfile_invalid");
    expect((caught as Error).message).toMatch(message);
  });

  it("maps to the local keyfile_invalid refusal by its code", () => {
    const r = refusalOf(new SecretFileError("the renderer secret file /x is malformed"));
    expect(r?.code).toBe("keyfile_invalid");
    expect(REFUSAL_EXIT[r!.code]).toBe(83);
  });
});

describe("parseHexSecret", () => {
  it.each([
    [HEX, HEX],
    [`${HEX}\n`, HEX],
    [HEX.toUpperCase(), undefined],
    [`${HEX}a`, undefined],
  ])("parses %j", (raw, expected) => {
    expect(parseHexSecret(raw)).toBe(expected);
  });
});
