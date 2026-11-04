export type SessionUser = { id: string; email: string; name: string; isAdmin: boolean };

type Claims = {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
  is_anonymous?: unknown;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

export function sessionUserFromClaims(claims: Claims | null | undefined): SessionUser | null {
  if (!claims || typeof claims.sub !== "string" || !claims.sub) return null;
  if (claims.role !== "authenticated" || claims.is_anonymous === true) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    name: displayName(claims.user_metadata),
    isAdmin: claims.app_metadata?.role === "admin",
  };
}

function displayName(meta: Record<string, unknown> | undefined): string {
  const value = meta?.full_name ?? meta?.name;
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}
