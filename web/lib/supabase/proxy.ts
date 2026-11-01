import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { supabaseEnv } from "@/lib/env";
import { type SessionUser, sessionUserFromClaims } from "@/lib/sessionUser";
import { SESSION_COOKIE_OPTIONS } from "./cookies";

export type SessionState = { user: SessionUser | null; unavailable: boolean };

export async function updateSession(
  request: NextRequest,
  forwardHeaders: Headers,
): Promise<{ response: NextResponse; session: SessionState }> {
  const { url, publishableKey } = supabaseEnv();
  const next = () => NextResponse.next({ request: { headers: forwardHeaders } });
  let response = next();
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        forwardHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = next();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  return {
    response,
    session: { user: sessionUserFromClaims(data?.claims), unavailable: !data && isAuthRetryableFetchError(error) },
  };
}
