"use client";

import { useEffect, useState } from "react";
import { ghost, input } from "@/components/profile/models/styles";

const danger =
  "rounded-full bg-danger-bg px-3.5 py-1.5 text-[12px] font-medium text-danger-fg transition hover:opacity-85 disabled:opacity-40";

export function ConfirmDialog(props: {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  requireText?: string;
  busy: boolean;
  onConfirm: (typed: string) => void;
  onCancel: () => void;
}) {
  const { id, requireText, busy, onCancel } = props;
  const [typed, setTyped] = useState("");
  const ready = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div id={id} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        id={`${id}-backdrop`}
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        disabled={busy}
        className="absolute inset-0 bg-black/30"
      />
      <form
        id={`${id}-panel`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) props.onConfirm(typed.trim());
        }}
        className="relative w-full max-w-[420px] space-y-3 rounded-2xl border border-border bg-bg p-5 shadow-lift"
      >
        <h2 id={`${id}-title`} className="font-display text-[22px] leading-none text-text-primary">
          {props.title}
        </h2>
        <p id={`${id}-body`} className="text-sm text-text-secondary">
          {props.body}
        </p>
        {requireText && (
          <div id={`${id}-typed`} className="space-y-1">
            <label id={`${id}-input-label`} htmlFor={`${id}-input`} className="block text-[12px] text-text-muted">
              {`Type ${requireText} to confirm`}
            </label>
            <input
              id={`${id}-input`}
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={input}
            />
          </div>
        )}
        <div id={`${id}-actions`} className="flex justify-end gap-2">
          <button id={`${id}-cancel`} type="button" autoFocus={!requireText} disabled={busy} onClick={onCancel} className={ghost}>
            Cancel
          </button>
          <button id={`${id}-confirm`} type="submit" disabled={!ready || busy} className={danger}>
            {busy ? "Working…" : props.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
