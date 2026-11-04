import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  chmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { ShellConfig } from "./shellConfig.ts";

export type ShellPaths = Readonly<{
  stateDir: string;
  logsDir: string;
  userData: string;
  stackFile: string;
  settingsFile: string;
  servicesFile: string;
  statusFile: string;
}>;

export type StateProblem = "missing" | "symlink" | "not_regular" | "foreign_owner" | "wide_mode" | "malformed";

const uid = () => (typeof process.getuid === "function" ? process.getuid() : -1);

export function resolvePaths(cfg: ShellConfig, electronPaths: { userData: string; logs: string }): ShellPaths {
  const stateDir = cfg.test && cfg.stateDir ? cfg.stateDir : electronPaths.userData;
  return {
    stateDir,
    userData: electronPaths.userData,
    logsDir: electronPaths.logs,
    stackFile: join(stateDir, "stack.json"),
    settingsFile: join(stateDir, "settings.json"),
    servicesFile: join(stateDir, "services.json"),
    statusFile: join(stateDir, "status.json"),
  };
}

export function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error(`${dir} is a symlink, not a directory`);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (st.uid !== uid()) throw new Error(`${dir} is owned by another user`);
  if ((st.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
}

export function readStateFile<T>(path: string, parse: (v: unknown) => T | undefined): { value?: T; problem?: StateProblem } {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { problem: "missing" };
    if (code === "ELOOP" || code === "EMLINK") return { problem: "symlink" };
    return { problem: "not_regular" };
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { problem: "not_regular" };
    if (st.uid !== uid()) return { problem: "foreign_owner" };
    if ((st.mode & 0o077) !== 0) return { problem: "wide_mode" };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(fd, "utf8"));
    } catch {
      return { problem: "malformed" };
    }
    const value = parse(raw);
    return value === undefined ? { problem: "malformed" } : { value };
  } finally {
    closeSync(fd);
  }
}

export function writeStateFile(path: string, value: unknown): void {
  const dir = dirname(path);
  ensurePrivateDir(dir);
  const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
  const fd = openSync(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  const dirFd = openSync(dir, constants.O_RDONLY);
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
