"use client";

import type { SignupMode } from "@oab/shared/usage";
import { useActionState, useState } from "react";
import { authInput, authSecondary } from "@/components/auth/AuthCard";
import { Turnstile } from "@/components/auth/Turnstile";
import type { EmailLinkState } from "@/lib/authForms";
import { requestEmailLink } from "./actions";

const INITIAL: EmailLinkState = { status: "idle" };

const COPY: Record<SignupMode, { sent: string; toggle: string; label: string }> = {
  invite: {
    sent: "If this email has been invited, a sign-in link is on its way.",
    toggle: "Invited, but no Google account? Get a sign-in link by email",
    label: "Already invited? Get a sign-in link by email.",
  },
  waitlist: {
    sent: "If this email has been invited, a sign-in link is on its way. Not invited yet? Request access below.",
    toggle: "Invited, but no Google account? Get a sign-in link by email",
    label: "Already invited? Get a sign-in link by email. This doesn't request access.",
  },
  open: {
    sent: "If this email has an account, a sign-in link is on its way.",
    toggle: "Have an account but no Google? Get a sign-in link by email",
    label: "Get a sign-in link by email. Links sign in existing accounts; new accounts are created with Google.",
  },
};

type Props = { startOpen?: boolean; mode?: SignupMode; siteKey?: string };

export function EmailLinkForm({ startOpen = false, mode = "waitlist", siteKey }: Props) {
  const [state, action, pending] = useActionState(requestEmailLink, INITIAL);
  const [open, setOpen] = useState(startOpen);
  const [token, setToken] = useState("");
  const [attempt, setAttempt] = useState(0);
  const copy = COPY[mode];
  const widgetKey = mode === "open" ? siteKey : undefined;
  if (state.status === "sent") {
    return (
      <p id="login-email-sent" role="status" className="rounded-xl bg-surface px-3.5 py-3 text-sm text-text-secondary">
        {copy.sent}
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
        {copy.toggle}
      </button>
    );
  }
  return (
    <form
      id="login-email-form"
      action={action}
      onSubmit={() => {
        if (!widgetKey) return;
        setAttempt((n) => n + 1);
        setToken("");
      }}
      className="space-y-2"
      noValidate
    >
      <label id="login-email-label" htmlFor="login-email-input" className="block text-[13px] text-text-secondary">
        {copy.label}
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
      {widgetKey && (
        <>
          <Turnstile
            key={attempt}
            id="login-email-turnstile"
            siteKey={widgetKey}
            action="email_link"
            onToken={setToken}
            onError={() => setToken("")}
            onExpire={() => setToken("")}
          />
          <input id="login-email-captcha" type="hidden" name="captchaToken" value={token} />
        </>
      )}
      <button id="login-email-submit" type="submit" disabled={pending || (!!widgetKey && !token)} className={authSecondary}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
