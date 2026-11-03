import { emptyProfile, type Profile } from "@oab/shared/profile";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { readApi } from "@/lib/api";

export type { Profile };

type State = { status: "idle" | "loading" | "ready" | "error"; profile: Profile | null; error?: string };

let state: State = { status: "idle", profile: null };
const listeners = new Set<() => void>();

const set = (next: State) => {
  state = next;
  for (const l of listeners) l();
};

async function call(init?: RequestInit): Promise<Profile> {
  const res = await fetch("/api/profile", { cache: "no-store", headers: { "content-type": "application/json" }, ...init });
  const body = await readApi<{ profile?: Profile }>(res);
  if (!body.profile) throw new Error("The agent didn't send a profile.");
  return body.profile;
}

export async function loadProfile(): Promise<Profile | null> {
  set({ ...state, status: "loading", error: undefined });
  try {
    const profile = await call();
    set({ status: "ready", profile });
    return profile;
  } catch (e) {
    set({ status: "error", profile: state.profile, error: (e as Error).message });
    return null;
  }
}

export async function saveProfile(p: Profile): Promise<Profile> {
  const profile = await call({ method: "PUT", body: JSON.stringify({ profile: p }) });
  set({ status: "ready", profile });
  return profile;
}

export function resetProfileStore(): void {
  set({ status: "idle", profile: null });
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const SERVER: State = { status: "idle", profile: null };

export function useProfile(): State & { reload: () => void } {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
  useEffect(() => {
    if (state.status === "idle") void loadProfile();
  }, []);
  return { ...current, reload: useCallback(() => void loadProfile(), []) };
}

export function clearedProfile(p: Profile): Profile {
  return {
    ...emptyProfile(),
    ...(p.defaultModel && { defaultModel: p.defaultModel }),
    ...(p.onboardedAt && { onboardedAt: p.onboardedAt }),
    ...(p.agent && { agent: p.agent }),
  };
}

export function initials(name: string | undefined): string {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}
