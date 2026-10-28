"use client";

import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type ModelList, type ModelOption, modelLabel, normalizeRef } from "@/lib/models";

export function ModelMenu(props: { models: ModelList | null; value: string | undefined; onChange: (id: string) => void; onManage: () => void }) {
  const { models, value, onChange } = props;
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
  const current = normalizeRef(value) ?? models.default ?? undefined;
  const groups = models.models.reduce<Array<{ provider: string; items: ModelOption[] }>>((acc, m) => {
    const name = m.provider ?? "Models";
    const g = acc.find((x) => x.provider === name);
    if (g) g.items.push(m);
    else acc.push({ provider: name, items: [m] });
    return acc;
  }, []);

  return (
    <div id="model-menu" ref={root} className="relative">
      <button
        id="model-menu-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="glass-pill inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] text-text-primary transition hover:bg-paper"
      >
        <span id="model-menu-dot" aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-mist-500" />
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
          <div id="model-menu-groups" className="max-h-[60vh] overflow-y-auto">
            {groups.map((g, gi) => (
              <div id={`model-menu-group-${gi}`} key={g.provider} role="group" aria-label={g.provider} className="py-1">
                <p id={`model-menu-group-${gi}-label`} className="px-2.5 pb-0.5 text-[11px] font-medium text-text-muted">
                  {g.provider}
                </p>
                {g.items.map((m, n) => {
                  const mid = `model-menu-item-${gi}-${n}`;
                  const on = m.id === current;
                  return (
                    <button
                      id={mid}
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${on ? "bg-surface" : "hover:bg-surface"}`}
                    >
                      <span id={`${mid}-check`} className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-text-primary">
                        {on && <Check id={`${mid}-icon`} aria-hidden="true" size={14} />}
                      </span>
                      <span id={`${mid}-text`} className="min-w-0">
                        <span id={`${mid}-label`} className="block text-sm font-medium text-text-primary">
                          {m.label}
                        </span>
                        {m.note && (
                          <span id={`${mid}-note`} className="block text-xs text-text-muted">
                            {m.note}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <button
            id="model-menu-manage"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              props.onManage();
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-xl border-t border-border px-2.5 py-2 text-left text-sm text-text-secondary transition hover:bg-surface hover:text-text-primary"
          >
            <SlidersHorizontal id="model-menu-manage-icon" aria-hidden="true" size={14} />
            Manage models…
          </button>
        </div>
      )}
    </div>
  );
}
