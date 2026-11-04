"use client";

import type { RunRefusalNoticeProps } from "@oab/ui/platform";
import { useEffect, useState } from "react";
import { countdownText, DESKTOP_URL, NOTICE_COPY, refusalCopy, retryDeadline, secondsUntil } from "@/lib/usageCopy";

const BUTTON =
  "rounded-full px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-mist-500 disabled:cursor-not-allowed disabled:opacity-50";

export function RefusalNotice({ id, refusal, onRetry, onDismiss }: RunRefusalNoticeProps) {
  const [receivedAt] = useState(Date.now);
  const [now, setNow] = useState(receivedAt);
  const deadline = retryDeadline(refusal, receivedAt);
  const left = secondsUntil(deadline, now);
  const copy = refusalCopy(refusal, secondsUntil(deadline, receivedAt), receivedAt);
  const ticking = copy.countdown && left > 0;

  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  return (
    <div
      id={id}
      role="status"
      className="mb-2 rounded-2xl border border-border bg-paper px-4 py-3 text-sm text-text-secondary shadow-float"
    >
      <p id={`${id}-title`} className="font-serif text-[20px] leading-tight text-text-primary">
        {copy.title}
      </p>
      <p id={`${id}-body`} className="mt-1">
        {copy.body}
      </p>
      {copy.countdown && (
        <p id={`${id}-countdown`} aria-live="polite" className="mt-1 text-[12.5px] text-text-muted">
          {countdownText(left)}
        </p>
      )}
      <div id={`${id}-actions`} className="mt-2.5 flex flex-wrap items-center gap-2">
        {copy.sendAgain !== "none" && (
          <button
            id={`${id}-retry`}
            type="button"
            disabled={copy.sendAgain === "countdown" && left > 0}
            onClick={onRetry}
            className={`${BUTTON} bg-charcoal text-on-charcoal`}
          >
            {NOTICE_COPY.sendAgain}
          </button>
        )}
        {copy.macLink && (
          <a
            id={`${id}-mac-link`}
            href={DESKTOP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${BUTTON} bg-charcoal text-on-charcoal`}
          >
            {NOTICE_COPY.macLink}
          </a>
        )}
        <button id={`${id}-dismiss`} type="button" onClick={onDismiss} className={`${BUTTON} text-text-secondary hover:text-text-primary`}>
          {NOTICE_COPY.dismiss}
        </button>
      </div>
    </div>
  );
}
