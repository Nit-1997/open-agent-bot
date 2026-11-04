import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, authPrimary, authSecondary } from "@/components/auth/AuthCard";
import { getClaimsOrNull, safeNext } from "@/lib/auth";
import { authErrorCopy } from "@oab/ui/lib/authErrors.ts";
import { firstParam } from "@/lib/authForms";
import { signupMode } from "@/lib/signupMode";
import { turnstileSiteKey } from "@/lib/turnstile";
import { signInWithGoogle } from "./actions";
import { EmailLinkForm } from "./EmailLinkForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  if (await getClaimsOrNull()) redirect(safeNext(firstParam(params.next)));
  const error = authErrorCopy(firstParam(params.error));
  const mode = await signupMode();
  const open = mode === "open";
  const siteKey = open ? turnstileSiteKey() : undefined;
  return (
    <AuthCard
      id="login"
      title="Sign in"
      subtitle={open ? "Continue with Google to sign in or create an account." : "Open Agent is invite-only."}
    >
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
      <EmailLinkForm startOpen={!!error} open={open} siteKey={siteKey} />
      {open && (
        <p id="login-legal" className="text-center text-[12px] text-text-muted">
          {"By continuing you agree to the "}
          <Link id="login-legal-terms" href="/terms" className="underline underline-offset-2">
            Terms
          </Link>
          {" and the "}
          <Link id="login-legal-privacy" href="/privacy" className="underline underline-offset-2">
            Privacy Policy
          </Link>
          .
        </p>
      )}
      {mode === "waitlist" && (
        <div id="login-request" className="space-y-2 border-t border-border pt-5">
          <p id="login-request-text" className="text-center text-[13px] text-text-secondary">
            New to Open Agent?
          </p>
          <Link id="login-request-link" href="/request-access" className={`${authSecondary} block text-center`}>
            Request access
          </Link>
        </div>
      )}
    </AuthCard>
  );
}
