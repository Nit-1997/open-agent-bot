import { type NextRequest, NextResponse } from "next/server";
import { artifactErrorPage, isFramedReport } from "@oab/bff";
import { safeNext } from "@/lib/auth";
import { YOUTUBE_EMBED_ORIGIN } from "@/lib/youtube";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";
import { appOrigin, supabaseEnv } from "@/lib/env";
import { decideRoute, type RouteDecision } from "@/lib/routeRules";
import { TURNSTILE_ORIGIN, turnstileSiteKey } from "@/lib/turnstile";
import { updateSession } from "@/lib/supabase/proxy";

const NOT_FOUND_PATH = "/__not-found";
const REPORT_PATH = "/api/artifacts/";
const LANDING_PATH = "/landing";

async function respond(
  request: NextRequest,
  decision: RouteDecision,
  passed: NextResponse,
  forwardHeaders: Headers,
): Promise<NextResponse> {
  switch (decision.kind) {
    case "pass":
      return passed;
    case "json": {
      const json = NextResponse.json({ error: decision.error }, { status: decision.status });
      if (!request.nextUrl.pathname.startsWith(REPORT_PATH) || !isFramedReport(request)) return json;
      const page = await artifactErrorPage(json, request.nextUrl.pathname);
      return new NextResponse(page.body, page);
    }
    case "landing":
      return NextResponse.rewrite(new URL(LANDING_PATH, request.url), { request: { headers: forwardHeaders } });
    case "not_found_page":
      if (request.nextUrl.pathname === NOT_FOUND_PATH) return NextResponse.next({ status: 404, request: { headers: forwardHeaders } });
      return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url), { status: 404, request: { headers: forwardHeaders } });
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
  const dev = process.env.NODE_ENV === "development";
  const turnstile = turnstileSiteKey() ? [TURNSTILE_ORIGIN] : [];
  const csp = contentSecurityPolicy(nonce, supabaseEnv().url, dev, turnstile, turnstile);
  const forwardHeaders = new Headers(request.headers);
  if (page) {
    forwardHeaders.set("x-nonce", nonce);
    forwardHeaders.set("content-security-policy", csp);
  }

  const { response, session } = await updateSession(request, forwardHeaders);
  const decision = decideRoute(pathname, session);
  const result = await respond(request, decision, response, forwardHeaders);
  if (result !== response) {
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) result.headers.set("cache-control", cacheControl);
  }
  const landing = decision.kind === "landing" || pathname === LANDING_PATH;
  if (page)
    result.headers.set(
      "content-security-policy",
      landing ? contentSecurityPolicy(nonce, supabaseEnv().url, dev, [YOUTUBE_EMBED_ORIGIN, ...turnstile], turnstile) : csp,
    );
  return result;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
