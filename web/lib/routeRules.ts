import type { SessionState } from "@/lib/supabase/proxy";

export type RouteDecision =
  | { kind: "pass" }
  | { kind: "login"; error?: "auth_unavailable" }
  | { kind: "json"; status: 401 | 404 | 503; error: "signed_out" | "not_found" | "auth_unavailable" }
  | { kind: "not_found_page" };

const PUBLIC_PATHS = new Set(["/login", "/request-access", "/auth/callback", "/auth/confirm", "/auth/signout", "/favicon.ico"]);

export const isPublicPath = (pathname: string) => PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next/");

const isAdminPage = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");
const isAdminApi = (pathname: string) => pathname === "/api/admin" || pathname.startsWith("/api/admin/");

export function decideRoute(pathname: string, session: SessionState): RouteDecision {
  if (isPublicPath(pathname)) return { kind: "pass" };
  const api = pathname === "/api" || pathname.startsWith("/api/");
  if (!session.user) {
    if (session.unavailable) {
      return api ? { kind: "json", status: 503, error: "auth_unavailable" } : { kind: "login", error: "auth_unavailable" };
    }
    return api ? { kind: "json", status: 401, error: "signed_out" } : { kind: "login" };
  }
  if (!session.user.isAdmin) {
    if (isAdminApi(pathname)) return { kind: "json", status: 404, error: "not_found" };
    if (isAdminPage(pathname)) return { kind: "not_found_page" };
  }
  return { kind: "pass" };
}
