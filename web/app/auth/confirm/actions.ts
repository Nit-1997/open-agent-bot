"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { parseConfirmInput } from "@/lib/authForms";
import { createClient } from "@/lib/supabase/server";

export async function confirmEmailLink(form: FormData): Promise<void> {
  const input = parseConfirmInput(form.get("type"), form.get("token_hash"));
  if (!input) redirect("/login?error=link_expired");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: input.type, token_hash: input.tokenHash });
  if (error) redirect(`/login?error=${isAuthRetryableFetchError(error) ? "auth_unavailable" : "link_expired"}`);
  redirect("/");
}
