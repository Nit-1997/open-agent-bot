import { SignOutForm } from "@/components/auth/SignOutForm";
import { AUTH_ERROR_COPY } from "@oab/ui/lib/authErrors.ts";

export function AccessDisabled() {
  return (
    <main id="session-disabled" className="flex h-dvh w-full flex-col items-center justify-center gap-4 px-4 text-center">
      <span id="session-disabled-orb" aria-hidden="true" className="orb h-10 w-10" />
      <h1 id="session-disabled-title" role="alert" className="font-display text-[28px] leading-tight text-text-primary">
        {AUTH_ERROR_COPY.account_disabled}
      </h1>
      <p id="session-disabled-text" className="max-w-sm text-sm text-text-muted">
        Ask the person who invited you if you think this is a mistake.
      </p>
      <SignOutForm
        id="session-disabled-signout"
        scope="local"
        className="rounded-full border border-border px-4 py-1.5 text-sm text-text-secondary transition hover:border-border-strong"
      >
        Sign out
      </SignOutForm>
    </main>
  );
}
