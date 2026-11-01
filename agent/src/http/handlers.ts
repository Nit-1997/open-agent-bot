import type { Context, Env, Handler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { UserError, type UserErrorKind } from "../lib/errors.js";
import { log } from "../lib/log.js";

const STATUS: Record<UserErrorKind, ContentfulStatusCode> = {
  invalid: 400,
  unprocessable: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  upstream: 502,
  unavailable: 503,
  internal: 500,
};

export function errorResponse(c: Context, err: UserError): Response {
  const { retryAfter, details } = err.opts;
  return c.json(
    { error: err.code, message: err.message, ...(retryAfter !== undefined && { retryAfter }), ...details },
    STATUS[err.kind],
    retryAfter !== undefined ? { "retry-after": String(retryAfter) } : undefined,
  );
}

export const safe =
  <E extends Env>(handler: (c: Context<E>) => Promise<Response> | Response): Handler<E> =>
  async (c) => {
    try {
      return await handler(c);
    } catch (err) {
      if (err instanceof UserError) return errorResponse(c, err);
      log.error(`[http] ${c.req.method} ${c.req.path} failed`, err);
      return c.json({ error: "internal", message: "Something went wrong on the agent. Check its logs." }, 500);
    }
  };

export const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

export const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

export function pageParam(c: Context): number {
  const raw = c.req.query("page") ?? "1";
  const page = Number(raw);
  if (!/^\d{1,6}$/.test(raw) || page < 1) throw new UserError("page must be a whole number from 1", "invalid");
  return page;
}
