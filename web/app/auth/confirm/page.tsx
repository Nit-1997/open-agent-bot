import Link from "next/link";
import { AuthCard, authPrimary } from "@/components/auth/AuthCard";
import { firstParam, parseConfirmInput } from "@/lib/authForms";
import { confirmEmailLink } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ConfirmPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const input = parseConfirmInput(firstParam(params.type), firstParam(params.token_hash));
  return (
    <AuthCard id="auth-confirm" title="Welcome to Open Agent" subtitle="One more click to sign in.">
      {input ? (
        <form id="auth-confirm-form" action={confirmEmailLink}>
          <input id="auth-confirm-token" type="hidden" name="token_hash" value={input.tokenHash} />
          <input id="auth-confirm-type" type="hidden" name="type" value={input.type} />
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
