import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { signFormTs } from "@/lib/formToken";
import { signupMode } from "@/lib/signupMode";
import { RequestAccessForm } from "./RequestAccessForm";

export const metadata: Metadata = { title: "Request access · Open Agent" };

export default async function RequestAccessPage() {
  await connection();
  const mode = await signupMode();
  if (mode === "open") redirect("/login");
  if (mode === "invite")
    return (
      <AuthCard id="request-access" title="Request access" subtitle="Open Agent is invite-only.">
        <p id="request-access-closed" role="status" className="rounded-xl bg-surface px-3.5 py-3 text-sm text-text-secondary">
          {"We're not taking requests right now."}
        </p>
        <p id="request-access-login" className="text-[13px] text-text-muted">
          Already invited?{" "}
          <Link id="request-access-login-link" href="/login" className="text-text-primary underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </AuthCard>
    );
  return (
    <AuthCard id="request-access" title="Request access" subtitle="Open Agent is invite-only. Tell us who you are and we'll be in touch.">
      <RequestAccessForm formTs={signFormTs()} />
      <p id="request-access-login" className="text-[13px] text-text-muted">
        Already invited?{" "}
        <Link id="request-access-login-link" href="/login" className="text-text-primary underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
