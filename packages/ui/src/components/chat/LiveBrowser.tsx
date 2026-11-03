"use client";

import { Maximize2, X } from "lucide-react";
import { type MouseEvent, type RefObject, useEffect, useRef, useState } from "react";
import { hostOf } from "../../lib/sources.ts";

export type BrowserFrame = { url: string; data: string };

function Expanded({
  id,
  src,
  host,
  opener,
  onClose,
}: {
  id: string;
  src: string;
  host: string;
  opener: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const closeFn = useRef(onClose);
  useEffect(() => {
    closeFn.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const back = opener.current;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFn.current();
      if (e.key === "Tab") {
        e.preventDefault();
        close.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      back?.focus();
    };
  }, [opener]);
  return (
    <div
      id={`${id}-expanded`}
      role="dialog"
      aria-modal="true"
      aria-label={`Browser view of ${host}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-3 sm:p-6"
      onClick={onClose}
    >
      <div id={`${id}-expanded-bar`} className="mb-2 flex items-center justify-between text-sm text-white/80">
        <span id={`${id}-expanded-host`}>{host}</span>
        <button
          id={`${id}-expanded-close`}
          ref={close}
          type="button"
          aria-label="Close browser view"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white"
        >
          <X id={`${id}-expanded-close-icon`} aria-hidden="true" size={18} />
        </button>
      </div>
      <img
        id={`${id}-expanded-img`}
        src={src}
        alt={`Browser view of ${host}`}
        className="min-h-0 flex-1 rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function LiveBrowser({ id, frame, live }: { id: string; frame: BrowserFrame; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const expand = (e: MouseEvent<HTMLElement>) => {
    opener.current = e.currentTarget;
    setExpanded(true);
  };
  const host = hostOf(frame.url) ?? "a page";
  const src = `data:image/jpeg;base64,${frame.data}`;
  const overlay = expanded && <Expanded id={id} src={src} host={host} opener={opener} onClose={() => setExpanded(false)} />;
  if (live) {
    return (
      <figure id={id} className="mb-3 overflow-hidden rounded-xl border border-border bg-surface">
        <figcaption id={`${id}-bar`} className="flex items-center gap-2 border-b border-border px-3 py-1 text-xs text-text-secondary">
          <span id={`${id}-dot`} aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-mist-500" />
          <span id={`${id}-label`} className="flex-1">
            Browsing {host}
          </span>
          <button
            id={`${id}-expand`}
            type="button"
            aria-label="Expand browser view"
            onClick={expand}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted hover:bg-surface-accent hover:text-text-primary focus-visible:outline-2 focus-visible:outline-mist-500"
          >
            <Maximize2 id={`${id}-expand-icon`} aria-hidden="true" size={14} />
          </button>
        </figcaption>
        <button
          id={`${id}-view`}
          type="button"
          aria-label={`Expand live view of ${host}`}
          onClick={expand}
          className="block w-full bg-paper focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-mist-500"
        >
          <img
            id={`${id}-img`}
            src={src}
            alt={`Live view of ${host}`}
            className="h-[min(34vh,260px)] w-full object-cover object-top sm:h-auto sm:max-h-80"
          />
        </button>
        {overlay}
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
        className="flex items-center gap-2 rounded-lg border border-border bg-paper px-2 py-1 text-xs text-text-muted hover:border-border-strong focus-visible:outline-2 focus-visible:outline-mist-500"
      >
        <img id={`${id}-thumb`} src={src} alt="" className="h-8 w-12 rounded object-cover object-top" />
        <span id={`${id}-thumb-label`}>Browser · {host}</span>
      </button>
      {open && (
        <button
          id={`${id}-full-button`}
          type="button"
          aria-label={`Expand last view of ${host}`}
          onClick={expand}
          className="mt-2 block w-full"
        >
          <img id={`${id}-full`} src={src} alt={`Last view of ${host}`} className="w-full rounded-xl border border-border" />
        </button>
      )}
      {overlay}
    </div>
  );
}
