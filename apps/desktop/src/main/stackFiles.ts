import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { currentUid } from "./fsProbe.ts";

export const STACK_FILES = ["docker-compose.yml", "local/renderer/seccomp.json"] as const;
const HASH_FILE = "stack.sha256";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

const fsyncPath = (p: string) => {
  const fd = openSync(p, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const lstatOr = (p: string) => {
  try {
    return lstatSync(p);
  } catch {
    return undefined;
  }
};

const privateDir = (p: string, uid: number) => {
  const st = lstatOr(p);
  return st?.isDirectory() && !st.isSymbolicLink() && st.uid === uid && (st.mode & 0o777) === 0o700;
};

const privateFile = (p: string, uid: number) => {
  const st = lstatOr(p);
  return st?.isFile() && st.uid === uid && (st.mode & 0o777) === 0o600;
};

export function hashLines(hashes: ReadonlyMap<string, string>): string {
  return `${[...hashes].map(([f, h]) => `${h}  ${f}`).join("\n")}\n`;
}

export function stagedProblem(stagedDir: string, bundled: ReadonlyMap<string, string>, uid: number = currentUid()): string | undefined {
  if (!privateDir(stagedDir, uid)) return "stack_dir";
  for (const sub of ["local", "local/renderer"]) if (!privateDir(join(stagedDir, sub), uid)) return `dir ${sub}`;
  const hashFile = join(stagedDir, HASH_FILE);
  if (!privateFile(hashFile, uid)) return "hash_file";
  if (readFileSync(hashFile, "utf8") !== hashLines(bundled)) return "hash_changed";
  for (const [f, h] of bundled) {
    const p = join(stagedDir, f);
    if (!privateFile(p, uid)) return `file ${f}`;
    if (sha(readFileSync(p)) !== h) return `content ${f}`;
  }
  return undefined;
}

const writePrivate = (path: string, data: Buffer | string) => {
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data) : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

export function cleanLeftovers(parent: string, name: string): string[] {
  const removed: string[] = [];
  for (const e of readdirSync(parent)) {
    if (e.startsWith(`${name}.tmp-`) || e.startsWith(`${name}.old-`)) {
      rmSync(join(parent, e), { recursive: true, force: true });
      removed.push(e);
    }
  }
  return removed;
}

export function stageStack(o: { bundledDir: string; stagedDir: string; trace?: (op: string) => void }): {
  sha256: string;
  restaged: boolean;
  reason?: string;
} {
  const uid = currentUid();
  const trace = o.trace ?? (() => {});
  const parent = dirname(o.stagedDir);
  const name = basename(o.stagedDir);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  for (const e of cleanLeftovers(parent, name)) trace(`clean ${e}`);

  const contents = new Map<string, Buffer>();
  const bundled = new Map<string, string>();
  for (const f of STACK_FILES) {
    const b = readFileSync(join(o.bundledDir, f));
    contents.set(f, b);
    bundled.set(f, sha(b));
  }
  const composeSha = bundled.get("docker-compose.yml")!;
  const problem = stagedProblem(o.stagedDir, bundled, uid);
  if (!problem) return { sha256: composeSha, restaged: false };

  const tmp = join(parent, `${name}.tmp-${randomBytes(6).toString("hex")}`);
  mkdirSync(join(tmp, "local/renderer"), { recursive: true, mode: 0o700 });
  for (const [f, b] of contents) writePrivate(join(tmp, f), b);
  writePrivate(join(tmp, HASH_FILE), hashLines(bundled));
  for (const d of ["local/renderer", "local", ""]) fsyncPath(join(tmp, d));
  trace("write tmp");

  const existing = lstatOr(o.stagedDir);
  let old: string | undefined;
  if (existing) {
    old = join(parent, `${name}.old-${randomBytes(6).toString("hex")}`);
    renameSync(o.stagedDir, old);
    trace("aside");
  }
  renameSync(tmp, o.stagedDir);
  trace("in");
  fsyncPath(parent);
  if (old) {
    rmSync(old, { recursive: true, force: true });
    trace("remove");
  }
  return { sha256: composeSha, restaged: true, reason: problem };
}

export function bundledComposeSha(bundledDir: string): string {
  return sha(readFileSync(join(bundledDir, "docker-compose.yml")));
}
