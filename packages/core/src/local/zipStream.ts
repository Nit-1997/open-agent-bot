import { once } from "node:events";
import { createDeflateRaw, crc32, deflateRawSync } from "node:zlib";

export class ZipTooLargeError extends Error {
  constructor() {
    super("the export is larger than a zip without Zip64 can hold");
  }
}

export type ZipLimits = Readonly<{ maxBytes: number; maxEntries: number }>;
const DEFAULT_LIMITS: ZipLimits = { maxBytes: 0xffffffff, maxEntries: 0xffff };

export interface ZipWriter {
  addBuffer(name: string, data: Buffer): Promise<void>;
  addStream(name: string, source: AsyncIterable<Buffer | string>): Promise<void>;
  finish(): Promise<{ entries: number; bytes: number }>;
}

type Central = Readonly<{ name: Buffer; crc: number; compressed: number; size: number; offset: number }>;

const FLAGS = 0x0808;
const DEFLATE = 8;
const VERSION = 20;

function dosStamp(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

function checkName(name: string): Buffer {
  const parts = name.split("/");
  if (!name || name.startsWith("/") || name.includes("\\") || parts.some((p) => p === ".." || p === "." || p === ""))
    throw new Error(`invalid zip entry name ${JSON.stringify(name)}`);
  return Buffer.from(name, "utf8");
}

export function createZipWriter(out: NodeJS.WritableStream, o: { limits?: Partial<ZipLimits>; now?: () => Date } = {}): ZipWriter {
  const limits = { ...DEFAULT_LIMITS, ...o.limits };
  const stamp = dosStamp((o.now ?? (() => new Date()))());
  const central: Central[] = [];
  let offset = 0;
  let failed: Error | undefined;
  out.on("error", (e: Error) => {
    failed ??= e;
  });
  const tooLarge = () => {
    failed = new ZipTooLargeError();
    return failed;
  };

  const write = async (chunk: Buffer) => {
    if (failed) throw failed;
    offset += chunk.length;
    if (offset > limits.maxBytes) throw tooLarge();
    const ok = out.write(chunk);
    if (!ok) await Promise.race([once(out, "drain"), once(out, "error").then(([e]) => Promise.reject(e))]);
    if (failed) throw failed;
  };

  const localHeader = (name: Buffer) => {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(VERSION, 4);
    h.writeUInt16LE(FLAGS, 6);
    h.writeUInt16LE(DEFLATE, 8);
    h.writeUInt16LE(stamp.time, 10);
    h.writeUInt16LE(stamp.date, 12);
    h.writeUInt16LE(name.length, 26);
    return Buffer.concat([h, name]);
  };

  const descriptor = (crc: number, compressed: number, size: number) => {
    const d = Buffer.alloc(16);
    d.writeUInt32LE(0x08074b50, 0);
    d.writeUInt32LE(crc, 4);
    d.writeUInt32LE(compressed, 8);
    d.writeUInt32LE(size, 12);
    return d;
  };

  const begin = async (name: string) => {
    if (failed) throw failed;
    const encoded = checkName(name);
    if (central.length + 1 > limits.maxEntries) throw tooLarge();
    const at = offset;
    await write(localHeader(encoded));
    return { encoded, at };
  };

  const end = async (entry: { encoded: Buffer; at: number }, crc: number, compressed: number, size: number) => {
    if (size > 0xffffffff || compressed > 0xffffffff) throw tooLarge();
    await write(descriptor(crc, compressed, size));
    central.push({ name: entry.encoded, crc, compressed, size, offset: entry.at });
  };

  return {
    async addBuffer(name, data) {
      const entry = await begin(name);
      const packed = deflateRawSync(data);
      await write(packed);
      await end(entry, crc32(data), packed.length, data.length);
    },
    async addStream(name, source) {
      const entry = await begin(name);
      const deflate = createDeflateRaw();
      let crc = 0;
      let size = 0;
      let compressed = 0;
      const pump = (async () => {
        for await (const chunk of deflate as AsyncIterable<Buffer>) {
          compressed += chunk.length;
          await write(chunk);
        }
      })();
      pump.catch(() => {});
      try {
        for await (const raw of source) {
          const chunk = typeof raw === "string" ? Buffer.from(raw) : raw;
          crc = crc32(chunk, crc);
          size += chunk.length;
          if (!deflate.write(chunk)) await Promise.race([once(deflate, "drain"), pump]);
        }
        deflate.end();
        await pump;
      } catch (e) {
        deflate.destroy();
        await pump.catch(() => {});
        throw e;
      }
      await end(entry, crc, compressed, size);
    },
    async finish() {
      if (failed) throw failed;
      const start = offset;
      for (const c of central) {
        const h = Buffer.alloc(46);
        h.writeUInt32LE(0x02014b50, 0);
        h.writeUInt16LE(VERSION | (3 << 8), 4);
        h.writeUInt16LE(VERSION, 6);
        h.writeUInt16LE(FLAGS, 8);
        h.writeUInt16LE(DEFLATE, 10);
        h.writeUInt16LE(stamp.time, 12);
        h.writeUInt16LE(stamp.date, 14);
        h.writeUInt32LE(c.crc, 16);
        h.writeUInt32LE(c.compressed, 20);
        h.writeUInt32LE(c.size, 24);
        h.writeUInt16LE(c.name.length, 28);
        h.writeUInt32LE((0o100600 << 16) >>> 0, 38);
        h.writeUInt32LE(c.offset, 42);
        await write(Buffer.concat([h, c.name]));
      }
      const size = offset - start;
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(central.length, 8);
      eocd.writeUInt16LE(central.length, 10);
      eocd.writeUInt32LE(size, 12);
      eocd.writeUInt32LE(start, 16);
      await write(eocd);
      return { entries: central.length, bytes: offset };
    },
  };
}
