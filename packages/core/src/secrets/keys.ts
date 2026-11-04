import type { CredentialKeys } from "./keyWrapper.js";

export const decode32 = (b64: string): Buffer | undefined => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return undefined;
  const buf = Buffer.from(b64, "base64");
  return buf.length === 32 ? buf : undefined;
};

export function parseCredentialKeys(raw: string): CredentialKeys {
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error("CREDENTIAL_KEYS is empty");
  const keys = new Map<number, Buffer>();
  for (const entry of entries) {
    const m = /^v([1-9]\d{0,5}):(.+)$/.exec(entry);
    if (!m) throw new Error("CREDENTIAL_KEYS entries must look like v<n>:<base64 of 32 bytes> with n ≥ 1");
    const version = Number(m[1]);
    const key = decode32(m[2]);
    if (!key) throw new Error(`CREDENTIAL_KEYS v${version} must decode to exactly 32 bytes`);
    if (keys.has(version)) throw new Error(`CREDENTIAL_KEYS lists v${version} twice`);
    keys.set(version, key);
  }
  return { current: Number(/^v(\d+)/.exec(entries[0])![1]), keys };
}
