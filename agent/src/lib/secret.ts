import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeFileAtomic } from "./files.js";

const MODE = 0o640;

export async function ensureSharedSecret(path: string): Promise<string> {
  const existing = (await readFile(path, "utf8").catch(() => "")).trim();
  if (existing) return existing;
  await mkdir(dirname(path), { recursive: true });
  const secret = randomBytes(32).toString("hex");
  await writeFileAtomic(path, secret, MODE);
  await chmod(path, MODE);
  return secret;
}
