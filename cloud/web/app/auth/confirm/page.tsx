import Link from "next/link";
import { cookies } from "next/headers";
import { AuthCard, authPrimary } from "@/components/auth/AuthCard";
import { isBoundTo, LINK_COOKIE } from "@/lib/authCookies";
import { firstParam, parseConfirmInput } from "@/lib/authForms";
import { confirmEmailLink } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const input = parseConfirmInput(firstParam(params.type), firstParam(params.token_hash), firstParam(params.email));
  const fromThisBrowser = input?.type === "email" && isBoundTo((await cookies()).get(LINK_COOKIE)?.value, input.email);
  return (
    <AuthCard id="auth-confirm" nav="none" title="Welcome to Open Agent" subtitle="One more click to sign in.">
      {input ? (
        <form id="auth-confirm-form" action={confirmEmailLink} className="space-y-3">
          <p id="auth-confirm-account" className="text-sm text-text-secondary">
            {input.type === "invite" ? "Accept the invite for " : "Sign in as "}
            <strong id="auth-confirm-email" className="font-medium text-text-primary">
              {input.email}
            </strong>
          </p>
          {input.type === "email" && !fromThisBrowser && (
            <p id="auth-confirm-warning" role="note" className="rounded-xl bg-warn-bg px-3.5 py-2.5 text-sm text-warn-fg">
              This link wasn&apos;t requested from this browser. Continue only if you asked for it and that is your email.
            </p>
          )}
          <input id="auth-confirm-token" type="hidden" name="token_hash" value={input.tokenHash} />
          <input id="auth-confirm-type" type="hidden" name="type" value={input.type} />
          <input id="auth-confirm-email-value" type="hidden" name="email" value={input.email} />
          <button id="auth-confirm-continue" type="submit" className={authPrimary}>
            Continue to Open Agent
          </button>
        </form>
      ) : (
        <p id="auth-confirm-invalid" role="alert" className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg">
          This link is incomplete.{" "}
          <Link id="auth-confirm-login-link" href="/login" className="underline underline-offset-2">
            Go to sign in
          </Link>
        </p>
      )}
    </AuthCard>
  );
}
