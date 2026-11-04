import { constants, accessSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";

export type FsStat = Readonly<{ uid: number; gid: number; mode: number; kind: "file" | "dir" | "socket" | "symlink" | "other" }>;

export interface FsProbe {
  lstat(path: string): FsStat | undefined;
  stat(path: string): FsStat | undefined;
  realpath(path: string): string | undefined;
  executable(path: string): boolean;
  list?(path: string): string[] | undefined;
  readText?(path: string): string | undefined;
}

const kindOf = (s: Stats): FsStat["kind"] => {
  if (s.isSymbolicLink()) return "symlink";
  if (s.isFile()) return "file";
  if (s.isDirectory()) return "dir";
  if (s.isSocket()) return "socket";
  return "other";
};

const toStat = (s: Stats): FsStat => ({ uid: s.uid, gid: s.gid, mode: s.mode & 0o7777, kind: kindOf(s) });

const attempt = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

export const realFs: FsProbe = {
  lstat: (p) => attempt(() => toStat(lstatSync(p))),
  stat: (p) => attempt(() => toStat(statSync(p))),
  realpath: (p) => attempt(() => realpathSync(p)),
  executable: (p) =>
    attempt(() => {
      accessSync(p, constants.X_OK);
      return true;
    }) ?? false,
  list: (p) => attempt(() => readdirSync(p)),
  readText: (p) => attempt(() => readFileSync(p, "utf8")),
};

export const currentUid = () => (typeof process.getuid === "function" ? process.getuid() : -1);
export const currentGroups = (): readonly number[] => (typeof process.getgroups === "function" ? process.getgroups() : []);
