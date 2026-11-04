"use client";

import { ghost, input } from "@oab/ui/components/profile/models/styles.ts";
import { usePlatform } from "@oab/ui/platform";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { deleteOwnAccount } from "@/app/account/actions";
import { DELETE_ACCOUNT_COPY as COPY } from "@/lib/accountCopy";
import { runAction } from "@/lib/actionResult";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const danger =
  "rounded-full bg-danger-bg px-3.5 py-1.5 text-[12px] font-medium text-danger-fg transition hover:opacity-85 disabled:opacity-40";

const leave = () => window.location.replace(window.location.origin);

export function DeleteAccountDialog({
  email,
  onCancel,
  onDeleted = leave,
}: {
  email: string;
  onCancel: () => void;
  onDeleted?: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLFormElement>(null);
  const ready = typed.trim().toLowerCase() === email.toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const result = await runAction(() => deleteOwnAccount(typed.trim()));
    if (result.ok) return onDeleted();
    setError(result.message);
    setBusy(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    e.stopPropagation();
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div id="delete-account-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <form
        id="delete-account-dialog"
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-body"
        onKeyDown={onKeyDown}
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-[420px] space-y-3 rounded-2xl border border-border bg-bg p-5 shadow-lift"
      >
        <h2 id="delete-account-title" className="font-display text-[22px] leading-none text-text-primary">
          {COPY.title}
        </h2>
        <p id="delete-account-body" className="text-sm text-text-secondary">
          {COPY.body}
        </p>
        <div id="delete-account-typed" className="space-y-1">
          <label id="delete-account-email-label" htmlFor="delete-account-email" className="block text-[12px] text-text-muted">
            {COPY.label(email)}
          </label>
          <input
            id="delete-account-email"
            type="email"
            autoFocus
            autoComplete="off"
            value={typed}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
            className={input}
          />
        </div>
        {error && (
          <p id="delete-account-error" role="alert" className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg">
            {error}
          </p>
        )}
        <div id="delete-account-actions" className="flex justify-end gap-2">
          <button id="delete-account-cancel" type="button" disabled={busy} onClick={onCancel} className={ghost}>
            {COPY.cancel}
          </button>
          <button id="delete-account-confirm" type="submit" disabled={!ready || busy} className={danger}>
            {busy ? COPY.working : COPY.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}

export function DeleteAccount({ id }: { id: string }) {
  const { email } = usePlatform().user;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (wasOpen.current && !open) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div id={`${id}-row`}>
      <button
        id={id}
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className="block text-sm text-danger-fg underline-offset-4 hover:underline"
      >
        {COPY.open}
      </button>
      <p id={`${id}-hint`} className="text-xs text-text-muted">
        {COPY.hint}
      </p>
      {open && <DeleteAccountDialog email={email} onCancel={() => setOpen(false)} />}
    </div>
  );
}
