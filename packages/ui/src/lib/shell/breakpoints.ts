"use client";

import { useSyncExternalStore } from "react";

export type Breakpoint = "desktop" | "tablet" | "phone";

const DESKTOP = "(min-width: 1024px)";
const TABLET = "(min-width: 768px)";

const query = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);

export function currentBreakpoint(): Breakpoint {
  if (query(DESKTOP)?.matches) return "desktop";
  if (query(TABLET)?.matches) return "tablet";
  return "phone";
}

function subscribe(cb: () => void): () => void {
  const lists = [query(DESKTOP), query(TABLET)].filter((m): m is MediaQueryList => !!m);
  for (const m of lists) m.addEventListener("change", cb);
  return () => {
    for (const m of lists) m.removeEventListener("change", cb);
  };
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, currentBreakpoint, () => "desktop");
}
