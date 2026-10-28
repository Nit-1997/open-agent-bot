"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type ModelList, modelLabel } from "@/lib/models";

export function ModelMenu({ models, value, onChange }: { models: ModelList | null; value: string | undefined; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!models) return null;
  const current = value ?? models.default;

  return (
    <div id="model-menu" ref={root} className="relative">
      <button
        id="model-menu-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-paper px-3 py-1.5 text-[13px] text-text-secondary transition hover:border-border-strong hover:text-text-primary"
      >
        <span id="model-menu-dot" aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cortex-500" />
        <span id="model-menu-label" className="max-w-[140px] truncate">
          {modelLabel(models, current)}
        </span>
        <ChevronDown id="model-menu-chevron" aria-hidden="true" size={13} className={`text-text-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id="model-menu-list" role="menu" aria-label="Model for this chat" className="absolute right-0 top-full z-30 mt-2 w-72 animate-rise rounded-2xl border border-border bg-paper p-1.5 shadow-lift">
          <p id="model-menu-hint" className="eyebrow px-2.5 pb-1.5 pt-1">
            This chat · from your next message
          </p>
          {models.models.map((m, n) => {
            const on = m.id === current;
            return (
              <button
                id={`model-menu-item-${n}`}
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${on ? "bg-cortex-50" : "hover:bg-surface"}`}
              >
                <span id={`model-menu-item-${n}-check`} className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-cortex-600">
                  {on && <Check id={`model-menu-item-${n}-icon`} aria-hidden="true" size={14} />}
                </span>
                <span id={`model-menu-item-${n}-text`} className="min-w-0">
                  <span id={`model-menu-item-${n}-label`} className="block text-sm font-medium text-text-primary">
                    {m.label}
                  </span>
                  {m.note && (
                    <span id={`model-menu-item-${n}-note`} className="block text-xs text-text-muted">
                      {m.note}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
