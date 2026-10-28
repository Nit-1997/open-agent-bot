"use client";

import { BookOpen, Check, ChevronDown, CloudSun, FileText, Plane, Search, Wrench } from "lucide-react";
import { useState } from "react";
import { stepKind, stepLabel, summarizeSteps } from "@/lib/steps";
import type { Step } from "@/lib/turns";
import { Favicon } from "./Favicon";

const ICONS = { search: Search, read: BookOpen, weather: CloudSun, flight: Plane, write: FileText, other: Wrench };

function seconds(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ActivitySteps(props: { id: string; steps: Step[]; running: boolean; startedAt?: number; endedAt?: number; now: number }) {
  const { id, steps, running } = props;
  const [open, setOpen] = useState(false);
  if (!running && !steps.length) return null;

  const current = [...steps].reverse().find((s) => !s.done);
  const elapsed = props.startedAt != null ? seconds((props.endedAt ?? props.now) - props.startedAt) : undefined;
  const headline = running
    ? current
      ? stepLabel(current.name, current.args, false)
      : steps.length
        ? "Putting it together"
        : "Thinking"
    : elapsed
      ? `Worked for ${elapsed}`
      : "Done";
  const summary = summarizeSteps(steps);

  return (
    <div id={id} className="mb-3">
      <button
        id={`${id}-toggle`}
        type="button"
        aria-expanded={open}
        disabled={!steps.length}
        onClick={() => setOpen((o) => !o)}
        className="group flex max-w-full items-center gap-2.5 rounded-full py-1 pr-2 text-sm text-text-muted transition enabled:hover:text-text-primary"
      >
        <span id={`${id}-orb`} aria-hidden="true" className={`orb h-4 w-4 shrink-0 ${running ? "animate-breathe" : "opacity-60"}`} />
        <span id={`${id}-headline`} role="status" aria-live="polite" className={`truncate ${running ? "shimmer-text font-medium" : ""}`}>
          {headline}
        </span>
        {(running ? elapsed : summary) && (
          <span id={`${id}-meta`} className="shrink-0 font-mono text-[12px] sm:text-[11px] text-text-faint">
            {running ? elapsed : summary}
          </span>
        )}
        {steps.length > 0 && <ChevronDown id={`${id}-chevron`} aria-hidden="true" size={14} className={`shrink-0 text-text-faint transition ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && (
        <ol id={`${id}-list`} className="ml-2 mt-1 animate-rise border-l border-border pl-4">
          {steps.map((s, i) => {
            const Icon = ICONS[stepKind(s.name)];
            const sid = `${id}-step-${i}`;
            return (
              <li id={sid} key={s.id} className="relative py-1.5">
                <span id={`${sid}-dot`} className="absolute -left-[25px] top-2 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-bg">
                  {s.done ? (
                    <Check id={`${sid}-check`} aria-hidden="true" size={10} className="text-text-muted" />
                  ) : (
                    <span id={`${sid}-spin`} className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-mist-500 border-t-transparent" />
                  )}
                </span>
                <span id={`${sid}-row`} className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <Icon id={`${sid}-icon`} aria-hidden="true" size={14} className="shrink-0 text-text-faint" />
                  <span id={`${sid}-label`} className="truncate">
                    {stepLabel(s.name, s.args, s.done)}
                  </span>
                </span>
                {s.sites.length > 0 && (
                  <span id={`${sid}-sites`} className="ml-[22px] mt-1 flex items-center gap-1">
                    <span id={`${sid}-stack`} className="flex -space-x-1">
                      {s.sites.slice(0, 6).map((h, j) => (
                        <Favicon key={h} id={`${sid}-site-${j}`} host={h} size={16} />
                      ))}
                    </span>
                    <span id={`${sid}-sites-count`} className="text-[12px] sm:text-[11px] text-text-faint">{`${s.sites.length} results`}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
