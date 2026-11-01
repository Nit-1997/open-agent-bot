export type SessionUser = { id: string; email: string; isAdmin: boolean };

type Claims = { sub?: unknown; email?: unknown; role?: unknown; is_anonymous?: unknown; app_metadata?: Record<string, unknown> };

export function sessionUserFromClaims(claims: Claims | null | undefined): SessionUser | null {
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  if (claims.role !== "authenticated" || claims.is_anonymous === true) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    isAdmin: claims.app_metadata?.role === "admin",
  };
}
