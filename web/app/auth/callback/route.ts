import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { callbackErrorCode } from "@/lib/authErrors";
import { appOrigin } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const NEXT_COOKIE = "oab_next";

export async function GET(req: Request) {
  const origin = appOrigin();
  const params = new URL(req.url).searchParams;
  const cookieStore = await cookies();
  const next = safeNext(cookieStore.get(NEXT_COOKIE)?.value, origin);
  cookieStore.delete({ name: NEXT_COOKIE, path: "/auth/callback" });
  const toLogin = (error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, origin), 303);

  const error = callbackErrorCode(params);
  if (error) return toLogin(error);
  const code = params.get("code");
  if (!code) return toLogin("auth_failed");
  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return toLogin("auth_failed");
  return NextResponse.redirect(new URL(next, origin), 303);
}
