import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import type { UserStatusCache } from "./status.js";
import { AuthError, type AuthUser, type Verifier } from "./verify.js";

export type AuthEnv = { Variables: { user: AuthUser } };

export type AdminCheck = (user: AuthUser) => Promise<boolean>;

export type Guards = {
  requireService: MiddlewareHandler;
  requireUser: MiddlewareHandler<AuthEnv>;
  requireAdmin: MiddlewareHandler<AuthEnv>;
};

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

export function serviceSecretMatches(given: string | undefined, expected: string): boolean {
  return timingSafeEqual(digest(given ?? ""), digest(expected)) && given !== undefined;
}

const signedOut = (c: Context) =>
  c.json({ error: "signed_out", message: "You were signed out. Sign in again." }, 401, {
    "www-authenticate": 'Bearer error="invalid_token"',
  });
const unavailable = (c: Context) =>
  c.json({ error: "auth_unavailable", message: "Can't reach the account service. Try again in a minute." }, 503);
const disabled = (c: Context) => c.json({ error: "account_disabled", message: "Your access has been turned off." }, 403);
const notFound = (c: Context) => c.json({ error: "not_found", message: "Not found." }, 404);

export function createGuards(deps: { serviceSecret: string; verify: Verifier; status: UserStatusCache; isLiveAdmin: AdminCheck }): Guards {
  const requireService: MiddlewareHandler = async (c, next) => {
    if (!serviceSecretMatches(c.req.header("x-agent-secret"), deps.serviceSecret)) return c.json({ error: "unauthorized" }, 401);
    await next();
  };

  const authenticate = async (c: Context<AuthEnv>): Promise<Response | undefined> => {
    const header = c.req.header("authorization") ?? "";
    const m = /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
    if (!m) return signedOut(c);
    let user: AuthUser;
    try {
      user = await deps.verify(m[1]);
    } catch (err) {
      if (err instanceof AuthError && err.code === "auth_unavailable") return unavailable(c);
      return signedOut(c);
    }
    let active: boolean;
    try {
      active = await deps.status.isActive(user.id);
    } catch (err) {
      log.warn(`[auth] status lookup failed user=${user.id}`, err instanceof UserError ? err.kind : "error");
      return unavailable(c);
    }
    if (!active) return disabled(c);
    c.set("user", user);
    return undefined;
  };

  const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const denied = await authenticate(c);
    if (denied) return denied;
    await next();
  };

  const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const denied = await authenticate(c);
    if (denied) return denied;
    const user = c.get("user");
    let ok = false;
    try {
      ok = user.isAdmin && (await deps.isLiveAdmin(user));
    } catch {
      return unavailable(c);
    }
    if (!ok) return notFound(c);
    await next();
  };

  return { requireService, requireUser, requireAdmin };
}
