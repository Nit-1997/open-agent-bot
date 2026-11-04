import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Session } from "electron";

export { validateAction } from "../shared/actions.ts";

export const SHELL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export type ScreenFile = Readonly<{ body: Uint8Array; type: string }>;
export type Manifest = ReadonlyMap<string, ScreenFile>;
export type ScreenResponse = Readonly<{ status: number; headers: Record<string, string>; body: Uint8Array }>;

export function buildManifest(dir: string): Manifest {
  const files = new Map<string, ScreenFile>();
  const walk = (abs: string, rel: string) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, e.name);
      const key = `${rel}/${e.name}`;
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path, key);
      else if (st.isFile() && TYPES[extname(e.name)]) files.set(key, { body: readFileSync(path), type: TYPES[extname(e.name)] ?? "" });
    }
  };
  walk(dir, "");
  return files;
}

const baseHeaders = (type: string) => ({
  "content-type": type,
  "content-security-policy": SHELL_CSP,
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
});

const NOT_FOUND: ScreenResponse = {
  status: 404,
  headers: baseHeaders("text/plain; charset=utf-8"),
  body: new TextEncoder().encode("not found"),
};

export function resolveScreenRequest(manifest: Manifest, url: string): ScreenResponse {
  if (/\.\.|%2e|%2f|%5c|\\/i.test(url)) return NOT_FOUND;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return NOT_FOUND;
  }
  if (u.protocol !== "oa-shell:" || u.host !== "screens" || u.search || u.hash || u.username || u.password) return NOT_FOUND;
  const file = manifest.get(u.pathname);
  return file ? { status: 200, headers: baseHeaders(file.type), body: file.body } : NOT_FOUND;
}

export function registerShellProtocol(shellSession: Session, dir: string): void {
  const manifest = buildManifest(dir);
  shellSession.protocol.handle("oa-shell", (request) => {
    const r = resolveScreenRequest(manifest, request.url);
    return new Response(Buffer.from(r.body), { status: r.status, headers: r.headers });
  });
}
