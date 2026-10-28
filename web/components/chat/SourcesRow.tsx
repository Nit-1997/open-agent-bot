"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { Source } from "@/lib/sources";
import { Favicon } from "./Favicon";

export function SourcesRow({ id, sources }: { id: string; sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  const hosts = [...new Set(sources.map((s) => s.host))].slice(0, 5);
  return (
    <div id={id} className="mt-3">
      <button
        id={`${id}-toggle`}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group inline-flex items-center gap-2 rounded-full border border-border bg-paper py-1 pl-1.5 pr-3 text-xs text-text-secondary transition hover:border-border-strong"
      >
        <span id={`${id}-stack`} className="flex -space-x-1.5">
          {hosts.map((h, i) => (
            <Favicon key={h} id={`${id}-stack-${i}`} host={h} size={20} />
          ))}
        </span>
        <span id={`${id}-count`} className="font-medium">{`${sources.length} source${sources.length === 1 ? "" : "s"}`}</span>
        <ChevronDown id={`${id}-chevron`} aria-hidden="true" size={14} className={`text-text-faint transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol id={`${id}-list`} className="mt-2 grid animate-rise gap-2 sm:grid-cols-2">
          {sources.map((s, i) => (
            <li id={`${id}-item-${i}`} key={s.url}>
              <a
                id={`${id}-link-${i}`}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2.5 rounded-xl border border-border bg-paper p-2.5 transition hover:border-border-strong hover:shadow-float"
              >
                <span id={`${id}-num-${i}`} className="mt-0.5 font-mono text-[10px] text-text-faint">
                  {i + 1}
                </span>
                <span id={`${id}-text-${i}`} className="min-w-0 flex-1">
                  <span id={`${id}-title-${i}`} className="line-clamp-2 text-[13px] font-medium leading-snug text-text-primary">
                    {s.title}
                  </span>
                  <span id={`${id}-host-${i}`} className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
                    <Favicon id={`${id}-fav-${i}`} host={s.host} size={14} className="ring-0" />
                    {s.host}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
