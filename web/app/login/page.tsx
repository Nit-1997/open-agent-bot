import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, authPrimary, authSecondary } from "@/components/auth/AuthCard";
import { getClaimsOrNull, safeNext } from "@/lib/auth";
import { authErrorCopy } from "@oab/ui/lib/authErrors.ts";
import { firstParam } from "@/lib/authForms";
import { signInWithGoogle } from "./actions";
import { EmailLinkForm } from "./EmailLinkForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (await getClaimsOrNull()) redirect(safeNext(firstParam(params.next)));
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
      <EmailLinkForm startOpen={!!error} />
      <div id="login-request" className="space-y-2 border-t border-border pt-5">
        <p id="login-request-text" className="text-center text-[13px] text-text-secondary">
          New to Open Agent?
        </p>
        <Link id="login-request-link" href="/request-access" className={`${authSecondary} block text-center`}>
          Request access
        </Link>
      </div>
    </AuthCard>
  );
}
