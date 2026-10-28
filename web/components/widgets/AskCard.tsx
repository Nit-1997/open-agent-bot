"use client";

import type { AskField, AskWidget } from "@shared/widgets";
import { Check, Minus, Plus } from "lucide-react";
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
  "rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text-primary outline-none transition focus:border-mist-300 disabled:opacity-60";

export function AskCard(props: { toolCallId: string; widget: AskWidget; locale: string; answered?: boolean; onAnswer?: (text: string) => void }) {
  const { widget, answered } = props;
  const id = `ask-${props.toolCallId}`;
  const [values, setValues] = useState<string[]>(() => widget.fields.map(initial));
  const set = (i: number, v: string) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)));
  const invalid = widget.fields.some((f, i) => f.type === "date_range" && nights(...(values[i].split("|") as [string, string])) < 0);

  return (
    <section id={id} className="w-full rounded-2xl border border-border-strong bg-paper p-4 shadow-float">
      <p id={`${id}-eyebrow`} className="eyebrow">
        Quick check
      </p>
      <h3 id={`${id}-question`} className="mt-1.5 text-[17px] font-medium text-text-primary">
        {widget.question}
      </h3>
      <div id={`${id}-fields`} className="mt-4 space-y-4">
        {widget.fields.map((f, i) => {
          const fid = `${id}-f${i}`;
          if (f.type === "date_range") {
            const [start, end] = values[i].split("|");
            const n = nights(start, end);
            return (
              <fieldset id={fid} key={i} disabled={answered} className="space-y-1.5">
                <legend id={`${fid}-label`} className="text-[13px] font-medium text-text-secondary">
                  {f.label}
                </legend>
                <div id={`${fid}-row`} className="flex flex-wrap items-center gap-2">
                  <input id={`${fid}-start`} type="date" aria-label={`${f.label} from`} value={start} onChange={(e) => set(i, `${e.target.value}|${end}`)} className={control} />
                  <span id={`${fid}-dash`} aria-hidden="true" className="text-text-faint">
                    →
                  </span>
                  <input id={`${fid}-end`} type="date" aria-label={`${f.label} to`} min={start} value={end} onChange={(e) => set(i, `${start}|${e.target.value}`)} className={control} />
                  <span id={`${fid}-nights`} className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${n < 0 ? "bg-danger-bg text-danger-fg" : "bg-surface text-text-secondary"}`}>
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
              <div id={fid} key={i} className="flex items-center justify-between gap-3">
                <span id={`${fid}-label`} className="text-[13px] font-medium text-text-secondary">
                  {f.label}
                </span>
                <div id={`${fid}-stepper`} className="flex items-center gap-1 rounded-full border border-border bg-bg p-1">
                  <button
                    id={`${fid}-less`}
                    type="button"
                    aria-label={`Fewer ${f.label}`}
                    disabled={answered || v <= min}
                    onClick={() => set(i, String(v - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface disabled:opacity-40"
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
                    className="flex h-7 w-7 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface disabled:opacity-40"
                  >
                    <Plus id={`${fid}-more-icon`} aria-hidden="true" size={14} />
                  </button>
                </div>
              </div>
            );
          }
          if (f.type === "choice") {
            return (
              <fieldset id={fid} key={i} disabled={answered} className="space-y-1.5">
                <legend id={`${fid}-label`} className="text-[13px] font-medium text-text-secondary">
                  {f.label}
                </legend>
                <div id={`${fid}-options`} role="radiogroup" className="flex flex-wrap gap-1.5">
                  {f.options.map((o, j) => {
                    const on = values[i] === o;
                    return (
                      <label
                        id={`${fid}-o${j}`}
                        key={o}
                        className={`cursor-pointer rounded-full border px-3 py-1.5 text-[13px] transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-mist-500 ${
                          on ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-bg text-text-secondary hover:border-border-strong"
                        }`}
                      >
                        <input id={`${fid}-o${j}-input`} type="radio" name={fid} value={o} checked={on} onChange={() => set(i, o)} className="sr-only" />
                        {o}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          }
          return (
            <div id={fid} key={i} className="space-y-1.5">
              <label id={`${fid}-label`} htmlFor={`${fid}-input`} className="block text-[13px] font-medium text-text-secondary">
                {f.label}
              </label>
              <input id={`${fid}-input`} value={values[i]} disabled={answered} placeholder={f.placeholder} onChange={(e) => set(i, e.target.value)} className={`${control} w-full`} />
            </div>
          );
        })}
      </div>
      <div id={`${id}-footer`} className="mt-5 flex items-center justify-end">
        {answered ? (
          <span id={`${id}-answered`} className="inline-flex items-center gap-1.5 text-[13px] text-text-muted">
            <Check id={`${id}-answered-icon`} aria-hidden="true" size={14} />
            Answered
          </span>
        ) : (
          <button
            id={`${id}-submit`}
            type="button"
            disabled={invalid || !props.onAnswer}
            onClick={() => props.onAnswer?.(formatAnswers(widget.fields, values, props.locale))}
            className="rounded-full bg-charcoal px-5 py-2 text-sm font-medium text-on-charcoal transition hover:opacity-85 disabled:bg-surface-accent disabled:text-text-faint"
          >
            {widget.submitLabel ?? "Looks good"}
          </button>
        )}
      </div>
    </section>
  );
}
