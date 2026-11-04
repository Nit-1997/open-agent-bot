import { crc32, inflateRawSync } from "node:zlib";

export type ZipEntry = Readonly<{ name: string; method: number; flags: number; crc: number; data: Buffer }>;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function readZip(buf: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("no end of central directory");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error(`bad central header at ${at}`);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const compressed = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`bad local header for ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== size) throw new Error(`size mismatch for ${name}`);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    entries.push({ name, method, flags, crc, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
