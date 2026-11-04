import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export function prepareAuthDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function lockFile(path: string): void {
  chmodSync(path, 0o600);
}

export function clearAuthDir(dir: string): number {
  if (!existsSync(dir)) return 0;
  const files = readdirSync(dir);
  for (const f of files) rmSync(join(dir, f), { recursive: true, force: true });
  return files.length;
}

export const deletedCount = (output: string): number => output.split("\n").filter((l) => /^deleted \S+$/.test(l)).length;
