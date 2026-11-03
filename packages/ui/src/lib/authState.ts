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

export function errorCodeIn(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  try {
    const body = JSON.parse(text.slice(start)) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

export function noteRunFailure(code: string | undefined): void {
  if (code === "account_disabled") set("account_disabled");
  else if (code === "signed_out") set("signed_out");
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
