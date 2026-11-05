"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HUMAN_CHECK_COPY } from "@/lib/humanCheckCopy";
import { turnstileSiteKey } from "@/lib/turnstile";
import { restoreFocus, useModalKeys } from "@/lib/useModalKeys";
import { Turnstile } from "./Turnstile";

type Phase = { kind: "waiting" } | { kind: "sending" } | { kind: "error"; message: string };

function siteKeyOrNull(): string | null {
  try {
    return turnstileSiteKey() ?? null;
  } catch {
    return null;
  }
}

async function confirmToken(token: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/human-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    if (res.status === 403) return { ok: false, message: HUMAN_CHECK_COPY.failed };
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    return { ok: false, message: typeof body?.message === "string" ? body.message : HUMAN_CHECK_COPY.unavailable };
  } catch {
    return { ok: false, message: HUMAN_CHECK_COPY.unavailable };
  }
}

export function HumanCheckDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [siteKey] = useState(siteKeyOrNull);
  const [phase, setPhase] = useState<Phase>(siteKey ? { kind: "waiting" } : { kind: "error", message: HUMAN_CHECK_COPY.unavailable });
  const [attempt, setAttempt] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    const before = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => {
      live.current = false;
      restoreFocus(before);
    };
  }, []);

  const close = () => {
    live.current = false;
    onCancel();
  };

  useModalKeys(panel, close);

  const onToken = async (token: string) => {
    setPhase({ kind: "sending" });
    const r = await confirmToken(token);
    if (!live.current) return;
    if (r.ok) return onDone();
    setPhase({ kind: "error", message: r.message });
    setAttempt((n) => n + 1);
  };

  return createPortal(
    <div id="human-check-overlay" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        id="human-check-dialog"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="human-check-title"
        aria-describedby="human-check-body"
        className="w-full max-w-[400px] space-y-3 rounded-2xl border border-border bg-bg p-5 shadow-lift"
      >
        <h2 id="human-check-title" className="font-display text-[22px] leading-none text-text-primary">
          {HUMAN_CHECK_COPY.title}
        </h2>
        <p id="human-check-body" className="text-sm text-text-secondary">
          {HUMAN_CHECK_COPY.body}
        </p>
        {siteKey && (
          <Turnstile
            key={attempt}
            id="human-check-widget"
            siteKey={siteKey}
            action="human_check"
            onToken={(t) => void onToken(t)}
            onError={() => setPhase({ kind: "error", message: HUMAN_CHECK_COPY.failed })}
            onExpire={() => setPhase({ kind: "waiting" })}
          />
        )}
        {phase.kind === "sending" && (
          <p id="human-check-sending" role="status" className="text-[13px] text-text-muted">
            {HUMAN_CHECK_COPY.sending}
          </p>
        )}
        {phase.kind === "error" && (
          <p id="human-check-error" role="alert" className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg">
            {phase.message}
          </p>
        )}
        <div id="human-check-actions" className="flex justify-end">
          <button
            id="human-check-cancel"
            ref={cancel}
            type="button"
            onClick={close}
            className="rounded-full border border-border px-3.5 py-1.5 text-[12px] font-medium text-text-primary hover:border-border-strong focus-visible:outline-2 focus-visible:outline-mist-500"
          >
            {HUMAN_CHECK_COPY.cancel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
