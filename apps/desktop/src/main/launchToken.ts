import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Session } from "electron";
import type { Log } from "./logger.ts";
import { readStateFile, writeStateFile } from "./statePaths.ts";

const TOKEN_RE = /^[0-9a-f]{64}$/;

export function newLaunchToken(): string {
  return randomBytes(32).toString("hex");
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function tokensEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const launchCookieUrl = (port: number) => `http://127.0.0.1:${port}`;

export async function installLaunchCookie(ses: Session, port: number, token: string): Promise<void> {
  await ses.cookies.set({ url: launchCookieUrl(port), name: "oa_launch", value: token, httpOnly: true, sameSite: "strict", secure: false });
}

export async function removeLaunchCookie(ses: Session, port: number): Promise<void> {
  await ses.cookies.remove(launchCookieUrl(port), "oa_launch");
}

export type StackFile = Readonly<{ schema: 1; project: string; port: number; launchToken: string; tokenCreatedAt: string }>;

export function parseStackFile(v: unknown): StackFile | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  if (r.schema !== 1 || typeof r.project !== "string" || typeof r.tokenCreatedAt !== "string") return undefined;
  if (typeof r.port !== "number" || !Number.isInteger(r.port)) return undefined;
  if (typeof r.launchToken !== "string" || !TOKEN_RE.test(r.launchToken)) return undefined;
  return { schema: 1, project: r.project, port: r.port, launchToken: r.launchToken, tokenCreatedAt: r.tokenCreatedAt };
}

export function loadStackToken(file: string, o: { project: string; port: number }, log: Log): { token: string; created: boolean } {
  const read = readStateFile(file, parseStackFile);
  if (read.value && read.value.project === o.project && read.value.port === o.port)
    return { token: read.value.launchToken, created: false };
  if (read.problem && read.problem !== "missing") log.warn(`[state] stack.json ${read.problem}; token discarded and rotated`);
  else if (read.value) log.info("[state] stack.json is for another project or port; token rotated");
  const token = newLaunchToken();
  writeStateFile(file, { schema: 1, project: o.project, port: o.port, launchToken: token, tokenCreatedAt: new Date().toISOString() });
  log.info(`[state] token created fp=${tokenFingerprint(token)}`);
  return { token, created: true };
}
