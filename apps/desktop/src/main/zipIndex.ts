import { closeSync, createReadStream, createWriteStream, fstatSync, openSync, readSync, rmSync } from "node:fs";
import { promises as streams, Transform } from "node:stream";
import { crc32, createInflateRaw } from "node:zlib";

export class ZipIndexError extends Error {}

export type ZipIndexEntry = Readonly<{
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}>;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_TAIL = 22 + 0xffff;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const n = readSync(fd, buf, 0, length, position);
  if (n !== length) throw new ZipIndexError("the zip is truncated");
  return buf;
}

export function readZipIndex(path: string): ZipIndexEntry[] {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size < 22) throw new ZipIndexError("not a zip file");
    const tailLen = Math.min(size, MAX_TAIL);
    const tail = readAt(fd, size - tailLen, tailLen);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new ZipIndexError("no end of central directory");
    const count = tail.readUInt16LE(end + 10);
    const dirSize = tail.readUInt32LE(end + 12);
    const dirAt = tail.readUInt32LE(end + 16);
    if (dirAt + dirSize > size - tailLen + end) throw new ZipIndexError("the central directory points outside the file");
    const dir = readAt(fd, dirAt, dirSize);
    const entries: ZipIndexEntry[] = [];
    let at = 0;
    for (let n = 0; n < count; n++) {
      if (at + 46 > dir.length || dir.readUInt32LE(at) !== CENTRAL) throw new ZipIndexError("a bad central directory entry");
      const nameLen = dir.readUInt16LE(at + 28);
      const extraLen = dir.readUInt16LE(at + 30);
      const commentLen = dir.readUInt16LE(at + 32);
      if (at + 46 + nameLen > dir.length) throw new ZipIndexError("a bad central directory entry");
      const entry: ZipIndexEntry = {
        name: dir.subarray(at + 46, at + 46 + nameLen).toString("utf8"),
        method: dir.readUInt16LE(at + 10),
        crc: dir.readUInt32LE(at + 16),
        compressedSize: dir.readUInt32LE(at + 20),
        size: dir.readUInt32LE(at + 24),
        localOffset: dir.readUInt32LE(at + 42),
      };
      if (entry.localOffset + 30 + entry.compressedSize > dirAt) throw new ZipIndexError(`${entry.name} points outside the file`);
      entries.push(entry);
      at += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

export async function extractEntry(path: string, entry: ZipIndexEntry, dest: string): Promise<void> {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipIndexError(`${entry.name} uses compression method ${entry.method}`);
  const fd = openSync(path, "r");
  let start: number;
  try {
    const header = readAt(fd, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL) throw new ZipIndexError(`no local header for ${entry.name}`);
    start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    closeSync(fd);
  }
  let crc = 0;
  let size = 0;
  const measure = new Transform({
    transform(chunk: Buffer, _enc, done) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      if (size > entry.size) return done(new ZipIndexError(`${entry.name} is larger than its directory entry`));
      done(null, chunk);
    },
  });
  const source = entry.compressedSize === 0 ? [] : createReadStream(path, { start, end: start + entry.compressedSize - 1 });
  const out = createWriteStream(dest, { flags: "wx", mode: 0o600 });
  try {
    await (entry.method === 8 ? streams.pipeline(source, createInflateRaw(), measure, out) : streams.pipeline(source, measure, out));
    if (size !== entry.size) throw new ZipIndexError(`${entry.name} has the wrong size`);
    if (crc !== entry.crc) throw new ZipIndexError(`${entry.name} fails its CRC check`);
  } catch (e) {
    rmSync(dest, { force: true });
    throw e;
  }
}
