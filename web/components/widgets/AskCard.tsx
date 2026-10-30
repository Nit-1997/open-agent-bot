"use client";

import type { AskField, AskWidget } from "@shared/widgets";
import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { useState } from "react";

const DAY = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const nights = (start: string, end: string) => Math.round((utc(end).getTime() - utc(start).getTime()) / DAY);

function initial(f: AskField): string {
  if (f.type === "date_range") return `${f.start}|${f.end}`;
  if (f.type === "number") return String(f.value ?? f.min ?? 1);
  return f.value ?? "";
}

function dateRange(value: string, locale: string): string {
  const [start, end] = value.split("|");
  const day = (iso: string) => utc(iso).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const year = (iso: string) => iso.slice(0, 4);
  if (start === end) return `${day(start)}, ${year(start)}`;
  const n = nights(start, end);
  const from = year(start) === year(end) ? day(start) : `${day(start)}, ${year(start)}`;
  return `${from} – ${day(end)}, ${year(end)} (${n} night${n === 1 ? "" : "s"})`;
}

export function formatAnswers(fields: AskField[], values: string[], locale: string): string {
  return fields
    .map((f, i) => {
      const v = values[i]?.trim() ?? "";
      if (!v) return null;
      return `${f.label}: ${f.type === "date_range" ? dateRange(v, locale) : v}`;
    })
    .filter(Boolean)
    .join("\n");
}

const control =
  "min-w-0 rounded-lg border border-border bg-bg px-2 py-1.5 text-[13px] text-text-primary outline-none transition focus-visible:border-mist-500 focus-visible:ring-2 focus-visible:ring-mist-300 disabled:opacity-60";
const row = "grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-x-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]";
const label = "text-[13px] font-medium leading-snug text-text-secondary";

export function AskCard(props: {
  toolCallId: string;
  widget: AskWidget;
  locale: string;
  answered?: boolean;
  onAnswer?: (text: string) => void;
}) {
  const { widget, answered } = props;
  const id = `ask-${props.toolCallId}`;
  const [values, setValues] = useState<string[]>(() => widget.fields.map(initial));
  const set = (i: number, v: string) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)));
  const invalid = widget.fields.some((f, i) => f.type === "date_range" && nights(...(values[i].split("|") as [string, string])) < 0);

  const fields = (
    <div id={`${id}-fields`} className="mt-3 space-y-2.5">
      {widget.fields.map((f, i) => {
        const fid = `${id}-f${i}`;
        if (f.type === "date_range") {
          const [start, end] = values[i].split("|");
          const n = nights(start, end);
          return (
            <fieldset id={fid} key={i} disabled={answered} className={row}>
              <legend id={`${fid}-label`} className={`${label} float-left`}>
                {f.label}
              </legend>
              <div id={`${fid}-row`} className="flex flex-wrap items-center gap-1.5">
                <input
                  id={`${fid}-start`}
                  type="date"
                  aria-label={`${f.label} from`}
                  value={start}
                  onChange={(e) => set(i, `${e.target.value}|${end}`)}
                  className={control}
                />
                <span id={`${fid}-dash`} aria-hidden="true" className="text-text-faint">
                  →
                </span>
                <input
                  id={`${fid}-end`}
                  type="date"
                  aria-label={`${f.label} to`}
                  min={start}
                  value={end}
                  onChange={(e) => set(i, `${start}|${e.target.value}`)}
                  className={control}
                />
                <span
                  id={`${fid}-nights`}
                  className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${n < 0 ? "bg-danger-bg text-danger-fg" : "bg-surface text-text-secondary"}`}
                >
                  {n < 0 ? "End is before start" : n === 0 ? "Same day" : `${n} night${n === 1 ? "" : "s"}`}
                </span>
              </div>
            </fieldset>
          );
        }
        if (f.type === "number") {
          const v = Number(values[i]);
          const min = f.min ?? 0;
          const max = f.max ?? 99;
          return (
            <div id={fid} key={i} role="group" aria-labelledby={`${fid}-label`} className={row}>
              <span id={`${fid}-label`} className={label}>
                {f.label}
              </span>
              <div id={`${fid}-stepper`} className="flex w-fit items-center gap-1 rounded-full border border-border bg-bg p-0.5">
                <button
                  id={`${fid}-less`}
                  type="button"
                  aria-label={`Fewer ${f.label}`}
                  disabled={answered || v <= min}
                  onClick={() => set(i, String(v - 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-mist-500 disabled:opacity-40"
                >
                  <Minus id={`${fid}-less-icon`} aria-hidden="true" size={14} />
                </button>
                <span id={`${fid}-value`} aria-live="polite" className="w-8 text-center text-sm font-medium tabular-nums">
                  {v}
                </span>
                <button
                  id={`${fid}-more`}
                  type="button"
                  aria-label={`More ${f.label}`}
                  disabled={answered || v >= max}
                  onClick={() => set(i, String(v + 1))}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-mist-500 disabled:opacity-40"
                >
                  <Plus id={`${fid}-more-icon`} aria-hidden="true" size={14} />
                </button>
              </div>
            </div>
          );
        }
        if (f.type === "choice") {
          return (
            <fieldset id={fid} key={i} disabled={answered} className={row}>
              <legend id={`${fid}-label`} className={`${label} float-left`}>
                {f.label}
              </legend>
              <div id={`${fid}-options`} role="radiogroup" aria-labelledby={`${fid}-label`} className="flex flex-wrap gap-1">
                {f.options.map((o, j) => {
                  const on = values[i] === o;
                  return (
                    <label
                      id={`${fid}-o${j}`}
                      key={o}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[13px] transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-mist-500 ${
                        on
                          ? "border-charcoal bg-charcoal text-on-charcoal"
                          : "border-border bg-bg text-text-secondary hover:border-border-strong"
                      }`}
                    >
                      <input
                        id={`${fid}-o${j}-input`}
                        type="radio"
                        name={fid}
                        value={o}
                        checked={on}
                        onChange={() => set(i, o)}
                        className="sr-only"
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        }
        return (
          <div id={fid} key={i} className={row}>
            <label id={`${fid}-label`} htmlFor={`${fid}-input`} className={label}>
              {f.label}
            </label>
            <input
              id={`${fid}-input`}
              value={values[i]}
              disabled={answered}
              placeholder={f.placeholder}
              onChange={(e) => set(i, e.target.value)}
              className={`${control} w-full`}
            />
          </div>
        );
      })}
    </div>
  );

  if (answered) {
    return (
      <details id={id} className="group w-full rounded-xl border border-border bg-paper px-3 py-2">
        <summary
          id={`${id}-summary`}
          className="flex cursor-pointer list-none items-center gap-2 text-[13px] text-text-muted focus-visible:outline-2 focus-visible:outline-mist-500 [&::-webkit-details-marker]:hidden"
        >
          <Check id={`${id}-answered-icon`} aria-hidden="true" size={14} className="text-success-fg" />
          <span id={`${id}-answered`} className="flex-1">
            Quick check answered
          </span>
          <ChevronDown id={`${id}-summary-chevron`} aria-hidden="true" size={14} className="transition group-open:rotate-180" />
        </summary>
        {fields}
      </details>
    );
  }

  return (
    <section
      id={id}
      aria-labelledby={`${id}-question`}
      className="w-full rounded-2xl border border-border-strong bg-paper p-3 shadow-float sm:p-4"
    >
      <p id={`${id}-eyebrow`} className="eyebrow">
        Quick check
      </p>
      <h3 id={`${id}-question`} className="mt-1 text-[15px] font-medium leading-snug text-text-primary">
        {widget.question}
      </h3>
      {fields}
      <div id={`${id}-footer`} className="mt-3 flex items-center justify-end">
        <button
          id={`${id}-submit`}
          type="button"
          disabled={invalid || !props.onAnswer}
          onClick={() => props.onAnswer?.(formatAnswers(widget.fields, values, props.locale))}
          className="rounded-full bg-charcoal px-4 py-1.5 text-[13px] font-medium text-on-charcoal transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500 disabled:bg-surface-accent disabled:text-text-faint"
        >
          {widget.submitLabel ?? "Looks good"}
        </button>
      </div>
    </section>
  );
}
