"use client";

import { useActionState } from "react";
import { authInput, authPrimary } from "@/components/auth/AuthCard";
import { type AccessRequestState, EMAIL_MAX, NAME_MAX, NOTE_MAX } from "@/lib/authForms";
import { submitAccessRequest } from "./actions";

const INITIAL: AccessRequestState = { status: "idle" };

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-danger-fg">
      {message}
    </p>
  );
}

export function RequestAccessForm({ formTs }: { formTs: string }) {
  const [state, action, pending] = useActionState(submitAccessRequest, INITIAL);
  if (state.status === "sent") {
    return (
      <p id="request-access-thanks" role="status" className="rounded-xl bg-surface px-3.5 py-3 text-sm text-text-secondary">
        Thanks. If you&apos;re approved, you&apos;ll get an email from Open Agent.
      </p>
    );
  }
  const errors = state.fieldErrors ?? {};
  return (
    <form id="request-access-form" action={action} className="space-y-3" noValidate>
      <div id="request-access-name-field" className="space-y-1">
        <label id="request-access-name-label" htmlFor="request-access-name" className="block text-[13px] text-text-secondary">
          Name
        </label>
        <input
          id="request-access-name"
          name="name"
          required
          maxLength={NAME_MAX}
          autoComplete="name"
          defaultValue={state.values?.name}
          aria-invalid={!!errors.name}
          className={authInput}
        />
        <FieldError id="request-access-name-error" message={errors.name} />
      </div>
      <div id="request-access-email-field" className="space-y-1">
        <label id="request-access-email-label" htmlFor="request-access-email" className="block text-[13px] text-text-secondary">
          Email
        </label>
        <input
          id="request-access-email"
          name="email"
          type="email"
          required
          maxLength={EMAIL_MAX}
          autoComplete="email"
          defaultValue={state.values?.email}
          aria-invalid={!!errors.email}
          className={authInput}
        />
        <FieldError id="request-access-email-error" message={errors.email} />
      </div>
      <div id="request-access-note-field" className="space-y-1">
        <label id="request-access-note-label" htmlFor="request-access-note" className="block text-[13px] text-text-secondary">
          Anything we should know? (optional)
        </label>
        <textarea
          id="request-access-note"
          name="note"
          rows={3}
          maxLength={NOTE_MAX}
          defaultValue={state.values?.note}
          aria-invalid={!!errors.note}
          className={`${authInput} resize-none`}
        />
        <FieldError id="request-access-note-error" message={errors.note} />
      </div>
      <div id="request-access-trap" aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label id="request-access-trap-label" htmlFor="request-access-company-website">
          Company website
        </label>
        <input id="request-access-company-website" name="company_website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input id="request-access-form-ts" type="hidden" name="form_ts" value={formTs} />
      {state.message && (
        <p id="request-access-error" role="alert" className="text-xs text-danger-fg">
          {state.message}
        </p>
      )}
      <button id="request-access-submit" type="submit" disabled={pending} className={authPrimary}>
        {pending ? "Sending…" : "Request access"}
      </button>
    </form>
  );
}
