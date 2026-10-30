"use client";

import type { Access } from "@shared/onboarding";
import { Check, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { addTag, cleanTag } from "@/lib/onboarding";

export type ChipOption = { value: string; label?: string; access?: Access };

const chipClass = (on: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition ${
    on ? "border-charcoal bg-charcoal text-on-charcoal" : "border-border bg-paper text-text-secondary hover:border-border-strong"
  }`;

export function Chip({
  id,
  on,
  onClick,
  children,
  access,
}: {
  id: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  access?: Access;
}) {
  return (
    <button id={id} type="button" aria-pressed={on} onClick={onClick} className={chipClass(on)}>
      {on && <Check id={`${id}-check`} aria-hidden="true" size={12} />}
      <span id={`${id}-text`}>{children}</span>
      {access && (
        <span
          id={`${id}-access`}
          className={`rounded-md px-1.5 py-px text-[10px] ${on ? "bg-mist-500 text-on-charcoal" : access === "searched" ? "bg-success-bg text-success-fg" : "bg-surface-accent text-text-muted"}`}
        >
          {access}
        </span>
      )}
    </button>
  );
}

export function AddChip({ id, onAdd }: { id: string; onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const commit = () => {
    if (cleanTag(text)) onAdd(text);
    setText("");
    setOpen(false);
  };
  if (!open) {
    return (
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-3 py-1 text-[13px] text-text-muted transition hover:text-text-primary"
      >
        <Plus id={`${id}-icon`} aria-hidden="true" size={12} />
        add
      </button>
    );
  }
  return (
    <input
      id={`${id}-input`}
      aria-label="Add your own"
      autoFocus
      value={text}
      maxLength={60}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setText("");
          setOpen(false);
        }
      }}
      placeholder="Type and press Enter"
      className="w-44 rounded-full border border-mist-300 bg-paper px-3 py-1 text-[13px] text-text-primary outline-none"
    />
  );
}

export function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div id={id} role="group" aria-labelledby={`${id}-label`} className="border-b border-border py-2 last:border-b-0">
      <p id={`${id}-label`} className="eyebrow mb-1.5">
        {label}
        {hint && (
          <span id={`${id}-hint`} className="ml-2 normal-case tracking-normal text-text-faint">
            {hint}
          </span>
        )}
      </p>
      <div id={`${id}-chips`} className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

export function ChipRow(props: {
  id: string;
  label: string;
  hint?: string;
  options: ChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  toggle: (list: string[], value: string) => string[];
  exclusive?: string[];
  allowAdd?: boolean;
}) {
  const known = new Set(props.options.map((o) => o.value.toLowerCase()));
  const custom = props.selected.filter((s) => !known.has(s.toLowerCase())).map((value): ChipOption => ({ value }));
  return (
    <Row id={props.id} label={props.label} hint={props.hint}>
      {[...props.options, ...custom].map((o, n) => (
        <Chip
          key={o.value}
          id={`${props.id}-chip-${n}`}
          on={props.selected.includes(o.value)}
          access={o.access}
          onClick={() => props.onChange(props.toggle(props.selected, o.value))}
        >
          {o.label ?? o.value}
        </Chip>
      ))}
      {props.allowAdd !== false && (
        <AddChip id={`${props.id}-add`} onAdd={(tag) => props.onChange(addTag(props.selected, tag, props.exclusive))} />
      )}
    </Row>
  );
}

export function SingleRow<T extends string>(props: {
  id: string;
  label: string;
  options: readonly { id: T; label: string }[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
}) {
  return (
    <Row id={props.id} label={props.label}>
      {props.options.map((o, n) => (
        <Chip
          key={o.id}
          id={`${props.id}-chip-${n}`}
          on={props.value === o.id}
          onClick={() => props.onChange(props.value === o.id ? undefined : o.id)}
        >
          {o.label}
        </Chip>
      ))}
    </Row>
  );
}
