import { chmodSync, closeSync, constants, existsSync, fstatSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { redact } from "./redact.ts";
import { ensurePrivateDir } from "./statePaths.ts";

export type Log = Readonly<{ info(m: string): void; warn(m: string): void; error(m: string): void }>;

const ESCAPES: Readonly<Record<string, string>> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
const needsEscape = (n: number) => n <= 0x1f || n === 0x7f || n === 0x2028 || n === 0x2029;

const escapeLine = (m: string) =>
  [...m]
    .map((c) => (needsEscape(c.codePointAt(0) ?? 0) ? (ESCAPES[c] ?? `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`) : c))
    .join("");

export function createLogger(o: {
  dir: string;
  tokens: () => readonly (string | undefined)[];
  file?: string;
  maxBytes?: number;
  keep?: number;
  now?: () => Date;
}): Log {
  const file = join(o.dir, o.file ?? "shell.log");
  const maxBytes = o.maxBytes ?? 5 * 1024 * 1024;
  const keep = o.keep ?? 3;
  const now = o.now ?? (() => new Date());

  const open = () => {
    ensurePrivateDir(o.dir);
    const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    if ((fstatSync(fd).mode & 0o777) !== 0o600) chmodSync(file, 0o600);
    return fd;
  };

  const rotate = () => {
    rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    if (existsSync(file)) renameSync(file, `${file}.1`);
  };

  const write = (level: string, message: string) => {
    const line = `${now().toISOString()} ${level} ${escapeLine(redact(message, o.tokens()))}\n`;
    let fd: number;
    try {
      fd = open();
    } catch {
      return;
    }
    try {
      if (fstatSync(fd).size + Buffer.byteLength(line) > maxBytes) {
        closeSync(fd);
        rotate();
        fd = open();
      }
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  };

  return { info: (m) => write("info", m), warn: (m) => write("warn", m), error: (m) => write("error", m) };
}

export const silentLog: Log = { info: () => {}, warn: () => {}, error: () => {} };
