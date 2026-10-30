import type { Context, Handler, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { UserError, type UserErrorKind } from "../lib/errors.js";
import { log } from "../lib/log.js";

export type Authorized = (secret: string | undefined) => boolean;

const STATUS: Record<UserErrorKind, ContentfulStatusCode> = {
  invalid: 400,
  not_found: 404,
  conflict: 409,
  upstream: 502,
  unavailable: 503,
};

export const safe =
  (handler: (c: Context) => Promise<Response> | Response): Handler =>
  async (c) => {
    try {
      return await handler(c);
    } catch (err) {
      if (err instanceof UserError) return c.json({ error: err.message }, STATUS[err.kind]);
      log.error(`[http] ${c.req.method} ${c.req.path} failed`, err);
      return c.json({ error: "Something went wrong on the agent. Check its logs." }, 500);
    }
  };

export const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

export const requireSecret =
  (authorized: Authorized): MiddlewareHandler =>
  async (c, next) => {
    if (!authorized(c.req.header("x-agent-secret"))) return c.json({ error: "unauthorized" }, 401);
    await next();
  };
