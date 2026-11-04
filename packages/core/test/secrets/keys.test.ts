import { describe, expect, it } from "vitest";
import { decode32, parseCredentialKeys } from "../../src/secrets/keys.js";

const b64 = (n: number, fill = 1) => Buffer.alloc(n, fill).toString("base64");

describe("decode32", () => {
  it("decodes base64 of exactly 32 bytes", () => {
    expect(decode32(b64(32, 7))).toEqual(Buffer.alloc(32, 7));
  });

  it("rejects other lengths and non-base64 text", () => {
    expect(decode32(b64(31))).toBeUndefined();
    expect(decode32(b64(33))).toBeUndefined();
    expect(decode32("")).toBeUndefined();
    expect(decode32(`${b64(32)}!`)).toBeUndefined();
    expect(decode32(`${b64(32).replace(/=+$/, "")}===`)).toBeUndefined();
  });
});

describe("parseCredentialKeys", () => {
  it("takes the first entry as current and keeps older keys for reading", () => {
    const keys = parseCredentialKeys(`v2:${b64(32, 2)},v1:${b64(32, 1)}`);
    expect(keys.current).toBe(2);
    expect([...keys.keys.keys()]).toEqual([2, 1]);
    expect(keys.keys.get(1)).toEqual(Buffer.alloc(32, 1));
  });

  it("rejects 31- and 33-byte keys, duplicate versions, v0 and junk", () => {
    expect(() => parseCredentialKeys(`v1:${b64(31)}`)).toThrow(/32 bytes/);
    expect(() => parseCredentialKeys(`v1:${b64(33)}`)).toThrow(/32 bytes/);
    expect(() => parseCredentialKeys(`v1:${b64(32)},v1:${b64(32, 2)}`)).toThrow(/twice/);
    expect(() => parseCredentialKeys(`v0:${b64(32)}`)).toThrow(/v<n>/);
    expect(() => parseCredentialKeys("")).toThrow(/empty/);
    expect(() => parseCredentialKeys("key")).toThrow(/v<n>/);
  });
});
