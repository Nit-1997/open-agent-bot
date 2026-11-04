import { jsonError } from "@oab/bff";
import { NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/agentServer";
import { appOrigin } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { dropSessionCookies } from "@/lib/supabase/session";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError(403, "bad_origin");
  const form = await req.formData().catch(() => null);
  const scope = form?.get("scope") === "global" ? "global" : "local";
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope });
  if (error) {
    // Supabase keeps the local session when it can't reach the server; drop it here so this browser is signed out anyway.
    await dropSessionCookies();
  }
  return NextResponse.redirect(new URL(error ? "/login?error=auth_unavailable" : "/login", appOrigin()), 303);
}
