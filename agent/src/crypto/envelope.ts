import { randomBytes } from "node:crypto";
import { gcmDecrypt, gcmEncrypt, KEY_BYTES, type KeyWrapper } from "./keyWrapper.js";

export type CredentialKind = "api_key" | "oauth";
export type CredentialContext = { userId: string; provider: string; kind: CredentialKind };
export type Sealed = { ciphertext: Buffer; nonce: Buffer; dekWrapped: Buffer; dekNonce: Buffer; keyVersion: number };

export class CredentialIntegrityError extends Error {
  constructor(readonly ctx: CredentialContext) {
    super(`credential failed integrity check user=${ctx.userId} provider=${ctx.provider}`);
    this.name = "CredentialIntegrityError";
  }
}

const valueAad = (c: CredentialContext) => Buffer.from(`oab/credential/v1\0${c.userId}\0${c.provider}\0${c.kind}`, "utf8");
const wrapAad = (c: CredentialContext, version: number) => Buffer.concat([valueAad(c), Buffer.from(`\0dek\0${version}`, "utf8")]);

export async function seal(w: KeyWrapper, plaintext: Buffer, ctx: CredentialContext): Promise<Sealed> {
  const dek = randomBytes(KEY_BYTES);
  try {
    const { ciphertext, nonce } = gcmEncrypt(dek, plaintext, valueAad(ctx));
    const wrapped = await w.wrap(dek, wrapAad(ctx, w.currentVersion));
    return { ciphertext, nonce, dekWrapped: wrapped.wrapped, dekNonce: wrapped.nonce, keyVersion: wrapped.version };
  } finally {
    dek.fill(0);
  }
}

async function unwrapDek(w: KeyWrapper, s: Sealed, ctx: CredentialContext): Promise<Buffer> {
  try {
    return await w.unwrap(s.dekWrapped, s.dekNonce, s.keyVersion, wrapAad(ctx, s.keyVersion));
  } catch {
    throw new CredentialIntegrityError(ctx);
  }
}

export async function open(w: KeyWrapper, s: Sealed, ctx: CredentialContext): Promise<Buffer> {
  const dek = await unwrapDek(w, s, ctx);
  try {
    return gcmDecrypt(dek, s.ciphertext, s.nonce, valueAad(ctx));
  } catch {
    throw new CredentialIntegrityError(ctx);
  } finally {
    dek.fill(0);
  }
}

export async function rewrap(w: KeyWrapper, s: Sealed, ctx: CredentialContext): Promise<Sealed> {
  const dek = await unwrapDek(w, s, ctx);
  try {
    gcmDecrypt(dek, s.ciphertext, s.nonce, valueAad(ctx)).fill(0);
    const wrapped = await w.wrap(dek, wrapAad(ctx, w.currentVersion));
    return { ...s, dekWrapped: wrapped.wrapped, dekNonce: wrapped.nonce, keyVersion: wrapped.version };
  } catch (err) {
    throw err instanceof CredentialIntegrityError ? err : new CredentialIntegrityError(ctx);
  } finally {
    dek.fill(0);
  }
}
