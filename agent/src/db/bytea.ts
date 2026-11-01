export const toBytea = (b: Buffer): string => `\\x${b.toString("hex")}`;

export function fromBytea(v: unknown): Buffer {
  if (typeof v !== "string" || !/^\\x([0-9a-f]{2})*$/i.test(v)) throw new Error("not a bytea hex value");
  return Buffer.from(v.slice(2), "hex");
}
