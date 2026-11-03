import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../lib/log.js";
import type { CredentialKeys } from "../secrets/keyWrapper.js";
import { parseCredentialKeys } from "../secrets/keys.js";
import { StartupRefusal } from "./refusal.js";

export type FileFacts = { isFile(): boolean; mode: number; uid: number };

export type SecretFileOptions<T> = {
  path: string;
  generate: () => string;
  parse: (raw: string) => T | undefined;
  label: string;
  fstat?: (fd: number) => FileFacts;
};

export type LocalKeysOptions = {
  keysDir: string;
  rendererDir: string;
  credentialRows: () => number;
  reset: boolean;
  resetCredentials: () => number;
};

const MAX_BYTES = 4096;
const KEK_LABEL = "credential key";
const RENDERER_LABEL = "renderer secret";

export const newHexSecret = (): string => randomBytes(32).toString("hex");
export const newAgentSecret = newHexSecret;
export const newKekFile = (): string => `v1:${randomBytes(32).toString("base64")}`;

export const parseHexSecret = (raw: string): string | undefined => /^([0-9a-f]{64})\n?$/.exec(raw)?.[1];

export function parseKekFile(raw: string): CredentialKeys | undefined {
  const entry = /^(v[1-9]\d{0,5}:[A-Za-z0-9+/]+={0,2})\n?$/.exec(raw)?.[1];
  if (!entry) return undefined;
  try {
    return parseCredentialKeys(entry);
  } catch {
    return undefined;
  }
}

const errnoOf = (err: unknown): string => (err as NodeJS.ErrnoException)?.code ?? "error";

const invalid = (subject: string, why: string) =>
  new StartupRefusal("keyfile_invalid", `${subject} ${why}. Open Agent never replaces a key file on its own`);

const savedKeys = (n: number) => `${n} saved model key${n === 1 ? "" : "s"}`;

function lstatOrMissing(path: string, subject: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (err) {
    if (errnoOf(err) === "ENOENT") return undefined;
    throw invalid(subject, `cannot be checked (${errnoOf(err)})`);
  }
}

function checkDir(dir: string, label: string, create: boolean): void {
  const subject = `the ${label} directory ${dir}`;
  let st = lstatOrMissing(dir, subject);
  if (!st) {
    if (!create) return;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
    } catch (err) {
      throw invalid(subject, `cannot be created (${errnoOf(err)})`);
    }
    st = lstatSync(dir);
  }
  if (st.isSymbolicLink()) throw invalid(subject, "is a symlink; use a real directory");
  if (!st.isDirectory()) throw invalid(subject, "is not a directory");
}

function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, constants.O_RDONLY);
    fsyncSync(fd);
  } catch {
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function createExclusive(path: string, content: string, subject: string): void {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(tmp, path);
    } catch (err) {
      if (errnoOf(err) !== "EEXIST") throw err;
    }
  } catch (err) {
    throw invalid(subject, `cannot be created (${errnoOf(err)})`);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
  fsyncDir(dirname(path));
}

export function readSecretFile<T>(o: Omit<SecretFileOptions<T>, "generate">): T {
  const subject = `the ${o.label} file ${o.path}`;
  checkDir(dirname(o.path), o.label, false);
  let fd: number;
  try {
    fd = openSync(o.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ELOOP" || code === "EMLINK") throw invalid(subject, "is a symlink; key files must be regular files");
    if (code === "ENOENT") throw invalid(subject, "does not exist");
    throw invalid(subject, `cannot be opened (${code})`);
  }
  try {
    const st = (o.fstat ?? fstatSync)(fd);
    if (!st.isFile()) throw invalid(subject, "is not a regular file");
    if (st.mode & 0o077) {
      throw invalid(subject, `is open to group or others (mode ${(st.mode & 0o777).toString(8)}); run chmod 600 ${o.path}`);
    }
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) throw invalid(subject, `is owned by uid ${st.uid}, not by this process (uid ${uid})`);
    const buf = Buffer.alloc(MAX_BYTES + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const value = n > MAX_BYTES ? undefined : o.parse(buf.subarray(0, n).toString("utf8"));
    buf.fill(0);
    if (value === undefined) throw invalid(subject, "is malformed");
    return value;
  } finally {
    closeSync(fd);
  }
}

export function loadOrCreateSecretFile<T>(o: SecretFileOptions<T>): T {
  const subject = `the ${o.label} file ${o.path}`;
  checkDir(dirname(o.path), o.label, true);
  if (!lstatOrMissing(o.path, subject)) createExclusive(o.path, `${o.generate()}\n`, subject);
  return readSecretFile(o);
}

export function loadLocalKeys(o: LocalKeysOptions): { kek: CredentialKeys; rendererSecret: string } {
  const kekPath = join(o.keysDir, "kek");
  checkDir(o.keysDir, KEK_LABEL, false);
  if (!lstatOrMissing(kekPath, `the ${KEK_LABEL} file ${kekPath}`)) {
    const rows = o.credentialRows();
    if (rows > 0 && !o.reset) {
      throw new StartupRefusal(
        "kek_missing",
        `the credential key ${kekPath} is missing but the database holds ${savedKeys(rows)} sealed with it. Restore the keys volume, or start once with OPEN_AGENT_RESET_CREDENTIALS=1 to delete them and re-enter them in Models`,
      );
    }
    if (rows > 0) {
      const deleted = o.resetCredentials();
      log.warn(
        `[startup] OPEN_AGENT_RESET_CREDENTIALS=1: the credential key was missing, so ${savedKeys(deleted)} were deleted and a new key was created; re-enter them in Models`,
      );
    }
  }
  const kek = loadOrCreateSecretFile({ path: kekPath, generate: newKekFile, parse: parseKekFile, label: KEK_LABEL });
  const rendererSecret = loadOrCreateSecretFile({
    path: join(o.rendererDir, "secret"),
    generate: newHexSecret,
    parse: parseHexSecret,
    label: RENDERER_LABEL,
  });
  return { kek, rendererSecret };
}
