"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LINK_COOKIE } from "@/lib/authCookies";
import { parseConfirmInput } from "@/lib/authForms";
import { createClient } from "@/lib/supabase/server";

export async function confirmEmailLink(form: FormData): Promise<void> {
  const input = parseConfirmInput(form.get("type"), form.get("token_hash"), form.get("email"));
  if (!input) redirect("/login?error=link_expired");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: input.type, token_hash: input.tokenHash });
  if (error) redirect(`/login?error=${isAuthRetryableFetchError(error) ? "auth_unavailable" : "link_expired"}`);
  (await cookies()).delete({ name: LINK_COOKIE, path: "/auth/confirm" });
  const { data } = await supabase.auth.getClaims();
  const signedInAs = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : null;
  if (signedInAs !== input.email) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/login?error=link_mismatch");
  }
  redirect("/");
}
