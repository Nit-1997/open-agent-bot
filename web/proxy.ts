import { type NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { appOrigin, supabaseEnv } from "@/lib/env";
import { decideRoute, type RouteDecision } from "@/lib/routeRules";
import { updateSession } from "@/lib/supabase/proxy";

const NOT_FOUND_PATH = "/__not-found";

function respond(request: NextRequest, decision: RouteDecision, passed: NextResponse, forwardHeaders: Headers): NextResponse {
  switch (decision.kind) {
    case "pass":
      return passed;
    case "json":
      return NextResponse.json({ error: decision.error }, { status: decision.status });
    case "not_found_page":
      return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url), { request: { headers: forwardHeaders } });
    case "login": {
      const origin = appOrigin();
      const url = new URL("/login", origin);
      url.searchParams.set("next", safeNext(`${request.nextUrl.pathname}${request.nextUrl.search}`, origin));
      if (decision.error) url.searchParams.set("error", decision.error);
      return NextResponse.redirect(url, 302);
    }
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const page = !pathname.startsWith("/api/");
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, supabaseEnv().url, process.env.NODE_ENV === "development");
  const forwardHeaders = new Headers(request.headers);
  if (page) {
    forwardHeaders.set("x-nonce", nonce);
    forwardHeaders.set("content-security-policy", csp);
  }

  const { response, session } = await updateSession(request, forwardHeaders);
  const result = respond(request, decideRoute(pathname, session), response, forwardHeaders);
  if (result !== response) {
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) result.headers.set("cache-control", cacheControl);
  }
  if (page) result.headers.set("content-security-policy", csp);
  return result;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
