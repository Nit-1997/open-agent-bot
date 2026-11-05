"use client";

import { useSyncExternalStore } from "react";

let settled = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function noteRunSettled(): void {
  settled += 1;
  for (const listener of listeners) listener();
}

export function useRunSettled(): number {
  return useSyncExternalStore(
    subscribe,
    () => settled,
    () => 0,
  );
}
