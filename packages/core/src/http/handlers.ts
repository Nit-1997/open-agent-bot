import type { Context, Env, Handler, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { UserError, type UserErrorKind } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { LIMITS, type RateLimiter, rateLimitError } from "../lib/rateLimit.js";

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

export const errorStatus = (err: UserError): ContentfulStatusCode => STATUS[err.kind];

export function errorBody(err: UserError): Record<string, unknown> {
  const { retryAfter, details } = err.opts;
  return { error: err.code, message: err.message, ...(retryAfter !== undefined && { retryAfter }), ...details };
}

export function errorResponse(c: Context, err: UserError): Response {
  const headers: Record<string, string> = {};
  if (err.opts.retryAfter !== undefined) headers["retry-after"] = String(err.opts.retryAfter);
  if (err.kind === "unauthorized") headers["www-authenticate"] = 'Bearer error="invalid_token"';
  return c.json(errorBody(err), errorStatus(err), headers);
}

export function limitBy<E extends { Variables: { user: { id: string } } }>(
  limiter: RateLimiter,
  name: keyof typeof LIMITS,
): MiddlewareHandler<E> {
  return async (c, next) => {
    const user = c.get("user") as { id: string } | undefined;
    if (!user) return errorResponse(c, new UserError("You were signed out. Sign in again.", "unauthorized", { code: "signed_out" }));
    const verdict = limiter.take(`${name}:${user.id}`, LIMITS[name]);
    if (!verdict.ok) return errorResponse(c, rateLimitError(verdict.retryAfter));
    await next();
  };
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
