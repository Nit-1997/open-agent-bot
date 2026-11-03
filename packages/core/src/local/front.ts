import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseRoute } from "@oab/shared/routes";
import { type Context, Hono } from "hono";
import { hostGuard } from "./hosts.js";
import { StartupRefusal } from "./refusal.js";
import { requestLog } from "./requestLog.js";

export type LocalFrontOptions = Readonly<{
  uiDir: string;
  port: number;
  bff: (req: Request) => Promise<Response>;
  log?: (line: string) => void;
}>;

export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

const PAGE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-security-policy": PAGE_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
});

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_STORE = "no-store";

const TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
});

const typeOf = (file: string) => TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";

function walk(dir: string, prefix: string, out: Map<string, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`, out);
    else if (entry.isFile()) out.set(`${prefix}${entry.name}`, path);
  }
}

function manifestOf(uiDir: string): Map<string, string> {
  const files = new Map<string, string>();
  try {
    walk(uiDir, "/", files);
  } catch {
    files.clear();
  }
  if (!files.has("/index.html")) throw new StartupRefusal("ui_missing", `UI build not found at ${uiDir}`);
  return files;
}

const isAppRoute = (path: string) => {
  const route = parseRoute(path);
  return route !== null && route.section !== "admin";
};

export function createLocalFront(o: LocalFrontOptions): Hono {
  const files = manifestOf(o.uiDir);
  const index = readFileSync(files.get("/index.html") as string);

  const page = (status: 200 | 404) =>
    new Response(index, { status, headers: { ...PAGE_HEADERS, "content-type": TYPES[".html"], "cache-control": NO_STORE } });

  const serve = async (c: Context) => {
    const path = c.req.path;
    const file = path === "/index.html" ? undefined : files.get(path);
    if (!file) return page(isAppRoute(path) ? 200 : 404);
    const body = await readFile(file);
    const cache = path.startsWith("/assets/") ? IMMUTABLE : NO_STORE;
    return new Response(body, { headers: { ...PAGE_HEADERS, "content-type": typeOf(file), "cache-control": cache } });
  };

  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }, 200, { "cache-control": NO_STORE }));
  app.use(hostGuard(o.port));
  app.use(requestLog(o.log));
  app.all("/api", (c) => o.bff(c.req.raw));
  app.all("/api/*", (c) => o.bff(c.req.raw));
  app.get("*", serve);
  app.all(
    "*",
    () =>
      new Response("Method Not Allowed", { status: 405, headers: { ...PAGE_HEADERS, allow: "GET, HEAD", "content-type": TYPES[".txt"] } }),
  );
  return app;
}
