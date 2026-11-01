"use client";

import { useSyncExternalStore } from "react";

export type AuthState = "active" | "signed_out" | "account_disabled";

let state: AuthState = "active";
const listeners = new Set<() => void>();

function set(next: AuthState) {
  if (state === "account_disabled" || state === next) return;
  state = next;
  for (const l of listeners) l();
}

export function noteAuthFailure(status: number, code: unknown): void {
  if (status === 403 && code === "account_disabled") set("account_disabled");
  else if (status === 401 && code === "signed_out") set("signed_out");
}

export function noteRunFailure(text: string): void {
  if (/account_disabled/.test(text)) set("account_disabled");
  else if (/signed_out/.test(text)) set("signed_out");
}

export function resetAuthState(): void {
  state = "active";
  for (const l of listeners) l();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => "active",
  );
}
