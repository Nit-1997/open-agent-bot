"use client";

import type { SlideId, SummaryLine } from "@/lib/onboarding";

export function Summary(props: {
  id: string;
  lines: SummaryLine[];
  starters: string[];
  starter: string | null;
  onEdit: (slide: SlideId) => void;
  onStarter: (s: string | null) => void;
}) {
  return (
    <div id={props.id} className="space-y-4">
      <ul id={`${props.id}-lines`} className="divide-y divide-border rounded-2xl bg-surface px-3.5 py-1">
        {props.lines.map((l, n) => (
          <li id={`${props.id}-line-${n}`} key={`${l.label}-${n}`}>
            <button
              id={`${props.id}-line-${n}-button`}
              type="button"
              onClick={() => props.onEdit(l.slide)}
              className="flex w-full items-baseline gap-3 py-2 text-left text-[13px]"
            >
              <span id={`${props.id}-line-${n}-label`} className="eyebrow w-20 shrink-0">
                {l.label}
              </span>
              <span id={`${props.id}-line-${n}-text`} className="min-w-0 flex-1 text-text-primary">
                {l.text}
              </span>
              <span id={`${props.id}-line-${n}-edit`} className="shrink-0 text-[11px] text-mist-600">
                edit
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div id={`${props.id}-starters`} className="space-y-2">
        <p id={`${props.id}-starters-label`} className="text-[13px] text-text-muted">
          Try one:
        </p>
        <div id={`${props.id}-starters-chips`} className="flex flex-wrap gap-1.5">
          {props.starters.map((s, n) => {
            const on = props.starter === s;
            return (
              <button
                id={`${props.id}-starter-${n}`}
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => props.onStarter(on ? null : s)}
                className={`rounded-full border px-3 py-1.5 text-[13px] transition ${on ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-paper text-text-secondary hover:border-border-strong"}`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
