import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, authPrimary } from "@/components/auth/AuthCard";
import { getClaimsOrNull, safeNext } from "@/lib/auth";
import { authErrorCopy } from "@/lib/authErrors";
import { firstParam } from "@/lib/authForms";
import { signInWithGoogle } from "./actions";
import { EmailLinkForm } from "./EmailLinkForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (await getClaimsOrNull()) redirect("/");
  const error = authErrorCopy(firstParam(params.error));
  return (
    <AuthCard id="login" title="Sign in" subtitle="Open Agent is invite-only.">
      {error && (
        <p id="login-error" role="alert" className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg">
          {error}
        </p>
      )}
      <form id="login-google-form" action={signInWithGoogle}>
        <input id="login-google-next" type="hidden" name="next" value={safeNext(firstParam(params.next))} />
        <button id="login-google" type="submit" className={authPrimary}>
          Continue with Google
        </button>
      </form>
      <div id="login-divider" className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-text-faint">
        <span id="login-divider-left" className="h-px flex-1 bg-border" />
        or
        <span id="login-divider-right" className="h-px flex-1 bg-border" />
      </div>
      <EmailLinkForm />
      <p id="login-request" className="text-[13px] text-text-muted">
        Not invited yet?{" "}
        <Link id="login-request-link" href="/request-access" className="text-text-primary underline underline-offset-2">
          Request access
        </Link>
      </p>
    </AuthCard>
  );
}
