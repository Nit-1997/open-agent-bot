import type { MiddlewareHandler } from "hono";
import { escapeControl, log } from "../lib/log.js";

const MAX_LINE = 200;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_SEGMENT = /^[A-Za-z0-9_-]{12}$/;

const pathOnly = (path: string) => path.split(/[?#]/, 1)[0];

const scrubSegments = (path: string) =>
  path
    .split("/")
    .map((s) => (UUID_SEGMENT.test(s) || REPORT_SEGMENT.test(s) ? ":id" : s))
    .join("/");

export function requestLine(method: string, path: string, status: number, ms: number): string {
  const head = `[http] ${escapeControl(method).slice(0, 16)} `;
  const tail = ` ${status} ${Math.round(ms)}ms`;
  const room = MAX_LINE - head.length - tail.length;
  const shown = escapeControl(scrubSegments(pathOnly(path)));
  return `${head}${shown.length > room ? `${shown.slice(0, room - 1)}…` : shown}${tail}`;
}

export function requestLog(write: (line: string) => void = (line) => log.info(line)): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    write(requestLine(c.req.method, c.req.path, c.res.status, performance.now() - started));
  };
}
