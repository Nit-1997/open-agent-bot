"use server";

import { normalizeEmail } from "@oab/shared/email";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { agentFetch } from "@/lib/agentServer";
import { safeNext } from "@/lib/auth";
import { LINK_COOKIE, LINK_COOKIE_MAX_AGE, linkBinding, NEXT_COOKIE } from "@/lib/authCookies";
import { clientIp, type EmailLinkState } from "@/lib/authForms";
import { appOrigin, ConfigError } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const UNAVAILABLE = "Can't send links right now. Try again in a minute.";

export async function signInWithGoogle(form: FormData): Promise<void> {
  const origin = appOrigin();
  (await cookies()).set(NEXT_COOKIE, safeNext(form.get("next"), origin), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth/callback",
    maxAge: 600,
  });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) redirect("/login?error=auth_failed");
  redirect(data.url);
}

export async function requestEmailLink(_prev: EmailLinkState, form: FormData): Promise<EmailLinkState> {
  const email = normalizeEmail(form.get("email"));
  if (!email) return { status: "invalid", message: "Enter a valid email address." };
  const ip = clientIp(await headers());
  try {
    const res = await agentFetch("/auth/email-link", null, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip && { "x-client-ip": ip }) },
      body: JSON.stringify({ email }),
    });
    if (res.status >= 500) return { status: "error", message: UNAVAILABLE };
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    return { status: "error", message: UNAVAILABLE };
  }
  (await cookies()).set(LINK_COOKIE, linkBinding(email), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth/confirm",
    maxAge: LINK_COOKIE_MAX_AGE,
  });
  return { status: "sent" };
}
