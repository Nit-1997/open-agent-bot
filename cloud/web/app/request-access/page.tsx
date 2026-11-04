import Link from "next/link";
import { connection } from "next/server";
import { AuthCard } from "@/components/auth/AuthCard";
import { signFormTs } from "@/lib/formToken";
import { RequestAccessForm } from "./RequestAccessForm";

export default async function RequestAccessPage() {
  await connection();
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
