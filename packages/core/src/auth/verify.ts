import { createRemoteJWKSet, customFetch, decodeProtectedHeader, errors, type JWTPayload, jwtVerify } from "jose";
import { normalizeId } from "@oab/shared/ids";
import type { AgentConfig } from "../config.js";
import { log } from "../lib/log.js";

export type VerifiedUser = { id: string; email: string; sessionId: string; isAdmin: boolean };

export type Verifier = (token: string) => Promise<VerifiedUser>;

export type AuthErrorCode = "invalid_token" | "expired_token" | "auth_unavailable";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}

const MAX_TOKEN_BYTES = 8 * 1024;

type SupabaseClaims = JWTPayload & {
  role?: unknown;
  email?: unknown;
  session_id?: unknown;
  is_anonymous?: unknown;
  amr?: unknown;
  app_metadata?: { role?: unknown };
};

const keySetUnreachable = (err: unknown) =>
  err instanceof errors.JWKSTimeout ||
  !(err instanceof errors.JOSEError) ||
  (err.code === "ERR_JOSE_GENERIC" && /JSON Web Key Set/.test(err.message));

const usedPassword = (amr: unknown) => Array.isArray(amr) && amr.some((m) => (m as { method?: unknown } | null)?.method === "password");

export function createVerifier(cfg: Pick<AgentConfig, "supabaseUrl">, opts: { fetch?: typeof fetch } = {}): Verifier {
  const jwks = createRemoteJWKSet(new URL(`${cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`), {
    cacheMaxAge: 600_000,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
    ...(opts.fetch && { [customFetch]: opts.fetch }),
  });
  const issuer = `${cfg.supabaseUrl}/auth/v1`;

  return async (token) => {
    if (!token || Buffer.byteLength(token) > MAX_TOKEN_BYTES) throw new AuthError("invalid_token");
    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new AuthError("invalid_token");
    }
    if (header.typ !== undefined && header.typ !== "JWT") throw new AuthError("invalid_token");
    log.debug(`[auth] verifying kid=${header.kid ?? "none"}`);

    let payload: SupabaseClaims;
    try {
      ({ payload } = await jwtVerify<SupabaseClaims>(token, jwks, {
        algorithms: ["ES256"],
        issuer,
        audience: "authenticated",
        requiredClaims: ["sub", "exp", "iat", "session_id", "role", "email"],
        clockTolerance: 30,
      }));
    } catch (err) {
      if (err instanceof errors.JWTExpired) throw new AuthError("expired_token");
      if (keySetUnreachable(err)) throw new AuthError("auth_unavailable");
      throw new AuthError("invalid_token");
    }

    const { sub, email, session_id, role, is_anonymous, app_metadata, amr } = payload;
    if (role !== "authenticated" || is_anonymous === true || usedPassword(amr)) throw new AuthError("invalid_token");
    const id = normalizeId(sub);
    if (!id) throw new AuthError("invalid_token");
    if (typeof email !== "string" || typeof session_id !== "string") throw new AuthError("invalid_token");
    log.debug(`[auth] verified user=${id}`);
    return { id, email: email.toLowerCase(), sessionId: session_id, isAdmin: app_metadata?.role === "admin" };
  };
}
