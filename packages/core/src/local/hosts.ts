import type { MiddlewareHandler } from "hono";

const LOOPBACK_NAMES = ["127.0.0.1", "localhost"] as const;

function checkedPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`the published port must be 1-65535, got ${port}`);
  return port;
}

export const localHosts = (port: number): readonly string[] => LOOPBACK_NAMES.map((name) => `${name}:${checkedPort(port)}`);

export const localOrigins = (port: number): readonly string[] => localHosts(port).map((host) => `http://${host}`);

const MISDIRECTED = "This host isn't served here.";

const isApi = (path: string) => path === "/api" || path.startsWith("/api/");

export function hostGuard(port: number): MiddlewareHandler {
  const allowed = new Set(localHosts(port));
  return async (c, next) => {
    if (c.req.method === "GET" && c.req.path === "/health") return next();
    if (allowed.has((c.req.header("host") ?? "").toLowerCase())) return next();
    c.header("cache-control", "no-store");
    return isApi(c.req.path) ? c.json({ error: "misdirected", message: MISDIRECTED }, 421) : c.text(MISDIRECTED, 421);
  };
}
