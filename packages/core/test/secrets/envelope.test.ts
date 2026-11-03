import { describe, expect, it } from "vitest";
import { parseCredentialKeys } from "../../src/config.js";
import { type CredentialContext, CredentialIntegrityError, open, rewrap, type Sealed, seal } from "../../src/secrets/envelope.js";
import { keyHint, oauthHint } from "../../src/secrets/hint.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";

const key = (n: number) => Buffer.alloc(32, n).toString("base64");
const v1 = new LocalKeyWrapper(parseCredentialKeys(`v1:${key(1)}`));
const v2 = new LocalKeyWrapper(parseCredentialKeys(`v2:${key(2)},v1:${key(1)}`));
const v2only = new LocalKeyWrapper(parseCredentialKeys(`v2:${key(2)}`));
const ctx: CredentialContext = { userId: "11111111-1111-4111-8111-111111111111", provider: "openrouter", kind: "api_key" };
const secret = Buffer.from('{"type":"api_key","key":"sk-or-v1-abcdef0123456789"}');

const flip = (b: Buffer, at = 0) => {
  const c = Buffer.from(b);
  c[at] ^= 0x01;
  return c;
};

describe("envelope encryption", () => {
  it("round-trips a value under a fresh data key each time", async () => {
    const a = await seal(v1, secret, ctx);
    const b = await seal(v1, secret, ctx);
    expect((await open(v1, a, ctx)).equals(secret)).toBe(true);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.nonce).toHaveLength(12);
    expect(a.dekWrapped).toHaveLength(48);
    expect(a.dekNonce).toHaveLength(12);
    expect(a.ciphertext).toHaveLength(secret.length + 16);
    expect(a.keyVersion).toBe(1);
  });

  it("fails closed when any stored field is tampered with", async () => {
    const s = await seal(v1, secret, ctx);
    const tampered: Sealed[] = [
      { ...s, ciphertext: flip(s.ciphertext) },
      { ...s, ciphertext: flip(s.ciphertext, s.ciphertext.length - 1) },
      { ...s, nonce: flip(s.nonce) },
      { ...s, dekWrapped: flip(s.dekWrapped) },
      { ...s, dekNonce: flip(s.dekNonce) },
      { ...s, keyVersion: 2 },
    ];
    for (const t of tampered) await expect(open(v2, t, ctx)).rejects.toBeInstanceOf(CredentialIntegrityError);
  });

  it("refuses a row moved to another user, provider or kind", async () => {
    const s = await seal(v1, secret, ctx);
    for (const other of [
      { ...ctx, userId: "22222222-2222-4222-8222-222222222222" },
      { ...ctx, provider: "openai" },
      { ...ctx, kind: "oauth" as const },
    ]) {
      await expect(open(v1, s, other)).rejects.toBeInstanceOf(CredentialIntegrityError);
    }
  });

  it("rewraps under the new master key without touching the value ciphertext", async () => {
    const s = await seal(v1, secret, ctx);
    const r = await rewrap(v2, s, ctx);
    expect(r.keyVersion).toBe(2);
    expect(r.ciphertext.equals(s.ciphertext)).toBe(true);
    expect(r.nonce.equals(s.nonce)).toBe(true);
    expect((await open(v2only, r, ctx)).equals(secret)).toBe(true);
    await expect(open(v2only, s, ctx)).rejects.toBeInstanceOf(CredentialIntegrityError);
  });

  it("refuses to rewrap a tampered row", async () => {
    const s = await seal(v1, secret, ctx);
    await expect(rewrap(v2, { ...s, ciphertext: flip(s.ciphertext) }, ctx)).rejects.toBeInstanceOf(CredentialIntegrityError);
  });

  it("names the user and provider, never the value, in the integrity error", async () => {
    const s = await seal(v1, secret, ctx);
    const err = await open(v1, { ...s, nonce: flip(s.nonce) }, ctx).catch((e: Error) => e);
    expect(String(err)).toContain(ctx.userId);
    expect(String(err)).not.toContain("sk-or");
  });
});

describe("hints", () => {
  it("keeps the prefix and the last four characters of long keys", () => {
    expect(keyHint("sk-ant-api03-aaaaaaaaaaaaaaaaaaaaa91f")).toBe("sk-ant-…a91f");
    expect(keyHint("sk-or-v1-bbbbbbbbbbbbbbbbbbbbbb77c2")).toBe("sk-or-…77c2");
    expect(keyHint("AIzaSyBbbbbbbbbbbbbbbbbbbbbbbbbbXYZW")).toBe("…XYZW");
    expect(keyHint("gsk_cccccccccccccccccccccccccc1234")).toBe("gsk_…1234");
  });

  it("shows only two characters of short keys", () => {
    expect(keyHint("short-key-12")).toBe("…12");
  });

  it("says signed in, with the account email when known", () => {
    expect(oauthHint("me@example.com")).toBe("Signed in · me@example.com");
    expect(oauthHint(undefined)).toBe("Signed in");
  });
});
