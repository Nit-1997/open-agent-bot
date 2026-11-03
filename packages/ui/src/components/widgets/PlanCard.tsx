"use client";

import { ExternalLink } from "./ExternalLink";
import type { Plan } from "@oab/shared/widgets";
import { Minus, Plus } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { PlanEdits } from "@oab/shared/workspace";
import { cardDate } from "@/lib/dates";
import { widgetId } from "./widgetId";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const INPUT = "rounded-lg border border-border bg-paper px-2 py-1 text-sm disabled:opacity-60";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div id={id} className="flex flex-col gap-1">
      <label id={`${id}-label`} htmlFor={`${id}-input`} className="text-xs text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Stepper({
  id,
  label,
  value,
  min = 1,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <Field id={id} label={label}>
      <div id={`${id}-control`} className="flex w-fit items-center rounded-full border border-border">
        <button
          id={`${id}-dec`}
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(value - 1)}
          className="p-1.5 text-text-secondary disabled:opacity-30"
        >
          <Minus id={`${id}-dec-icon`} aria-hidden="true" size={12} />
        </button>
        <input
          id={`${id}-input`}
          type="number"
          inputMode="numeric"
          min={min}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            if (Number.isFinite(n) && n >= min) onChange(n);
          }}
          className="w-12 bg-transparent text-center text-sm [appearance:textfield] disabled:opacity-60"
        />
        <button
          id={`${id}-inc`}
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={() => onChange(value + 1)}
          className="p-1.5 text-text-secondary disabled:opacity-30"
        >
          <Plus id={`${id}-inc-icon`} aria-hidden="true" size={12} />
        </button>
      </div>
    </Field>
  );
}

function DateField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  if (value && !ISO_DAY.test(value.slice(0, 10))) {
    return (
      <Field id={id} label={label}>
        <span id={`${id}-input`} className="py-1 text-sm">
          {value}
        </span>
      </Field>
    );
  }
  return (
    <Field id={id} label={label}>
      <input
        id={`${id}-input`}
        type="date"
        value={value?.slice(0, 10) ?? ""}
        disabled={disabled}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className={INPUT}
      />
    </Field>
  );
}

function BudgetField({
  id,
  value,
  currency,
  disabled,
  onChange,
}: {
  id: string;
  value: number | undefined;
  currency?: string;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <Field id={id} label={`Budget${currency ? ` (${currency})` : ""}`}>
      <input
        id={`${id}-input`}
        type="number"
        inputMode="decimal"
        min={0}
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n) && n >= 0) onChange(n);
        }}
        className={`${INPUT} w-28`}
      />
    </Field>
  );
}

type EventDraft = { guests: number; date?: string; budget?: number };
type TripDraft = { start: string; end: string; travelers: number; budget?: number };

export function PlanCard({
  toolCallId,
  idPrefix,
  widget,
  onEdit,
  stale = false,
  locale,
  lockedAt,
  agentName = "the agent",
  now,
}: {
  toolCallId: string;
  idPrefix?: string;
  widget: Plan;
  onEdit?: (e: PlanEdits) => void;
  stale?: boolean;
  locale?: string;
  lockedAt?: string | null;
  agentName?: string;
  now?: Date;
}) {
  const id = widgetId("plan", toolCallId, idPrefix);
  const locked = stale || !onEdit;
  const shownOn = lockedAt === undefined ? undefined : cardDate(lockedAt, locale, now);
  const initial =
    widget.entity === "event"
      ? { guests: widget.value.guests, date: widget.value.date, budget: widget.value.budget }
      : widget.entity === "trip"
        ? { start: widget.value.start, end: widget.value.end, travelers: widget.value.travelers, budget: widget.value.budget }
        : {};
  const [draft, setDraft] = useState<Record<string, number | string | undefined>>(initial);
  const set = (patch: Record<string, number | string>) => setDraft((d) => ({ ...d, ...patch }));

  const report = useEffectEvent((d: Record<string, number | string | undefined>) => {
    if (widget.entity === "shortlist") return;
    const changed = Object.fromEntries(Object.entries(d).filter(([k, v]) => v !== (initial as Record<string, unknown>)[k]));
    onEdit?.({ [widget.entity]: changed });
  });
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      touched.current = true;
      return;
    }
    report(draft);
  }, [draft]);

  const title = widget.entity === "event" ? widget.value.title : widget.entity === "trip" ? widget.value.destination : widget.value.title;
  const kindLabel = widget.entity === "event" ? "Event" : widget.entity === "trip" ? "Trip" : "Shortlist";
  const ev = draft as EventDraft;
  const tr = draft as TripDraft;

  return (
    <section id={id} className={`my-2 w-full rounded-2xl border border-border bg-paper p-3 sm:p-4 ${stale ? "opacity-70" : ""}`}>
      <header id={`${id}-header`} className="flex items-baseline justify-between gap-2">
        <h3 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h3>
        <span id={`${id}-kind`} className="text-xs text-text-muted">
          {stale ? "Updated plan below" : kindLabel}
        </span>
      </header>
      {lockedAt !== undefined && (
        <p id={`${id}-locked-note`} className="mt-1 text-xs text-text-muted">
          {shownOn ? `From ${shownOn} · ask ${agentName} to update it` : `From an earlier session · ask ${agentName} to update it`}
        </p>
      )}

      {widget.entity === "event" && (
        <div id={`${id}-fields`} className="mt-3 flex flex-wrap items-end gap-4">
          <Stepper id={`${id}-guests`} label="Guests" value={ev.guests} disabled={locked} onChange={(n) => set({ guests: n })} />
          <DateField id={`${id}-date`} label="Date" value={ev.date} disabled={locked} onChange={(v) => set({ date: v })} />
          {(ev.budget !== undefined || !locked) && (
            <BudgetField
              id={`${id}-budget`}
              value={ev.budget}
              currency={widget.value.currency}
              disabled={locked}
              onChange={(n) => set({ budget: n })}
            />
          )}
        </div>
      )}
      {widget.entity === "event" && (widget.value.location || widget.value.theme) && (
        <p id={`${id}-where`} className="mt-2 text-xs text-text-muted">
          {[widget.value.location, widget.value.theme].filter(Boolean).join(" · ")}
        </p>
      )}
      {widget.entity === "event" && !!widget.value.menu?.length && (
        <ul id={`${id}-menu`} className="mt-3 flex flex-wrap gap-1.5">
          {widget.value.menu.map((m, i) => (
            <li id={`${id}-menu-${i}`} key={i} className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-text-secondary">
              {m}
            </li>
          ))}
        </ul>
      )}
      {widget.entity === "event" && !!widget.value.timeline?.length && (
        <ol id={`${id}-timeline`} className="mt-3 space-y-1 text-sm">
          {widget.value.timeline.map((t, i) => (
            <li id={`${id}-timeline-${i}`} key={i} className="flex gap-2">
              <span id={`${id}-timeline-${i}-when`} className="w-28 shrink-0 text-text-muted">
                {t.when}
              </span>
              <span id={`${id}-timeline-${i}-what`}>{t.what}</span>
            </li>
          ))}
        </ol>
      )}

      {widget.entity === "trip" && (
        <div id={`${id}-fields`} className="mt-3 flex flex-wrap items-end gap-4">
          <DateField id={`${id}-start`} label="Start" value={tr.start} disabled={locked} onChange={(v) => set({ start: v })} />
          <DateField id={`${id}-end`} label="End" value={tr.end} disabled={locked} onChange={(v) => set({ end: v })} />
          <Stepper
            id={`${id}-travelers`}
            label="Travelers"
            value={tr.travelers}
            disabled={locked}
            onChange={(n) => set({ travelers: n })}
          />
          {(tr.budget !== undefined || !locked) && (
            <BudgetField id={`${id}-budget`} value={tr.budget} disabled={locked} onChange={(n) => set({ budget: n })} />
          )}
        </div>
      )}
      {widget.entity === "trip" && !!widget.value.stays.length && (
        <ul id={`${id}-stays`} className="mt-3 space-y-1 text-sm">
          {widget.value.stays.map((s, i) => (
            <li id={`${id}-stays-${i}`} key={i}>
              {s.url ? (
                <ExternalLink id={`${id}-stays-${i}-link`} href={s.url} className="font-medium hover:underline">
                  {s.name}
                </ExternalLink>
              ) : (
                <span id={`${id}-stays-${i}-name`} className="font-medium">
                  {s.name}
                </span>
              )}
              {s.note && (
                <span id={`${id}-stays-${i}-note`} className="text-text-muted">
                  {" "}
                  · {s.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {widget.entity === "trip" && !!widget.value.days.length && (
        <ol id={`${id}-days`} className="mt-3 space-y-1 text-sm">
          {widget.value.days.map((d, i) => (
            <li id={`${id}-days-${i}`} key={i} className="flex gap-2">
              <span id={`${id}-days-${i}-date`} className="w-24 shrink-0 text-text-muted">
                {d.date}
              </span>
              <span id={`${id}-days-${i}-items`}>{d.items.join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}

      {widget.entity === "shortlist" && (
        <ul id={`${id}-items`} className="mt-3 space-y-1 text-sm">
          {widget.value.items.map((s, i) => (
            <li id={`${id}-items-${i}`} key={i}>
              {s.url ? (
                <ExternalLink id={`${id}-items-${i}-link`} href={s.url} className="font-medium hover:underline">
                  {s.name}
                </ExternalLink>
              ) : (
                <span id={`${id}-items-${i}-name`} className="font-medium">
                  {s.name}
                </span>
              )}
              {s.price !== undefined && (
                <span id={`${id}-items-${i}-price`} className="text-text-muted">
                  {" "}
                  · {s.price}
                </span>
              )}
              {s.note && (
                <span id={`${id}-items-${i}-note`} className="text-text-muted">
                  {" "}
                  · {s.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
