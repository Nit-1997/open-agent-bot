"use client";

import { useState } from "react";
import { hostOf } from "@/lib/sources";

export type BrowserFrame = { url: string; data: string };

export function LiveBrowser({ id, frame, live }: { id: string; frame: BrowserFrame; live: boolean }) {
  const [open, setOpen] = useState(false);
  const host = hostOf(frame.url) ?? "a page";
  const src = `data:image/jpeg;base64,${frame.data}`;
  if (live) {
    return (
      <figure id={id} className="mb-3 overflow-hidden rounded-xl border border-border bg-surface">
        <figcaption id={`${id}-bar`} className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-secondary">
          <span id={`${id}-dot`} aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-mist-500" />
          <span id={`${id}-label`}>Browsing {host}</span>
        </figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img id={`${id}-img`} src={src} alt={`Live view of ${host}`} className="max-h-72 w-full object-cover object-top" />
      </figure>
    );
  }
  return (
    <div id={id} className="mb-3">
      <button
        id={`${id}-toggle`}
        type="button"
        aria-expanded={open}
        aria-label={`Last view of ${host}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-border bg-paper px-2 py-1 text-xs text-text-muted hover:border-border-strong"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img id={`${id}-thumb`} src={src} alt="" className="h-8 w-12 rounded object-cover object-top" />
        <span id={`${id}-thumb-label`}>Browser · {host}</span>
      </button>
      {open && (
        // eslint-disable-next-line @next/next/no-img-element
        <img id={`${id}-full`} src={src} alt={`Last view of ${host}`} className="mt-2 w-full rounded-xl border border-border" />
      )}
    </div>
  );
}
