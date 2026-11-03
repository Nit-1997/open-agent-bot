import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CredentialKeys } from "../config.js";

export type Wrapped = { wrapped: Buffer; nonce: Buffer; version: number };

export interface KeyWrapper {
  readonly currentVersion: number;
  wrap(dek: Buffer, aad: Buffer): Promise<Wrapped>;
  unwrap(wrapped: Buffer, nonce: Buffer, version: number, aad: Buffer): Promise<Buffer>;
}

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;

export function gcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer): { ciphertext: Buffer; nonce: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, nonce };
}

export function gcmDecrypt(key: Buffer, ciphertext: Buffer, nonce: Buffer, aad: Buffer): Buffer {
  if (nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BYTES) throw new Error("malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAG_BYTES));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - TAG_BYTES)), decipher.final()]);
}

export class LocalKeyWrapper implements KeyWrapper {
  constructor(private readonly keys: CredentialKeys) {}

  get currentVersion(): number {
    return this.keys.current;
  }

  async wrap(dek: Buffer, aad: Buffer): Promise<Wrapped> {
    const { ciphertext, nonce } = gcmEncrypt(this.key(this.keys.current), dek, aad);
    return { wrapped: ciphertext, nonce, version: this.keys.current };
  }

  async unwrap(wrapped: Buffer, nonce: Buffer, version: number, aad: Buffer): Promise<Buffer> {
    return gcmDecrypt(this.key(version), wrapped, nonce, aad);
  }

  private key(version: number): Buffer {
    const key = this.keys.keys.get(version);
    if (!key) throw new Error(`no credential key v${version}`);
    return key;
  }
}
