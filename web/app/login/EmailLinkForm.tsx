"use client";

import { useActionState, useState } from "react";
import { authInput, authSecondary } from "@/components/auth/AuthCard";
import type { EmailLinkState } from "@/lib/authForms";
import { requestEmailLink } from "./actions";

const INITIAL: EmailLinkState = { status: "idle" };

export function EmailLinkForm({ startOpen = false }: { startOpen?: boolean }) {
  const [state, action, pending] = useActionState(requestEmailLink, INITIAL);
  const [open, setOpen] = useState(startOpen);
  if (state.status === "sent") {
    return (
      <p id="login-email-sent" role="status" className="rounded-xl bg-surface px-3.5 py-3 text-sm text-text-secondary">
        If this email has been invited, a sign-in link is on its way. Not invited yet? Request access below.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        id="login-email-toggle"
        type="button"
        aria-expanded={false}
        aria-controls="login-email-form"
        onClick={() => setOpen(true)}
        className="w-full text-center text-[13px] text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
      >
        Invited, but no Google account? Get a sign-in link by email
      </button>
    );
  }
  return (
    <form id="login-email-form" action={action} className="space-y-2" noValidate>
      <label id="login-email-label" htmlFor="login-email-input" className="block text-[13px] text-text-secondary">
        {"Already invited? Get a sign-in link by email. This doesn't request access."}
      </label>
      <input
        id="login-email-input"
        name="email"
        type="email"
        required
        maxLength={254}
        autoComplete="email"
        placeholder="you@example.com"
        aria-invalid={state.status === "invalid"}
        aria-describedby={state.message ? "login-email-error" : undefined}
        className={authInput}
      />
      {state.message && (
        <p id="login-email-error" role="alert" className="text-xs text-danger-fg">
          {state.message}
        </p>
      )}
      <button id="login-email-submit" type="submit" disabled={pending} className={authSecondary}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
