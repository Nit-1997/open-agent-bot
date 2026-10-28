import { useSyncExternalStore } from "react";

export type Profile = { name: string; home: string; interests: string[]; notes: string; defaultModel?: string; onboarded: boolean };

export const EMPTY_PROFILE: Profile = { name: "", home: "", interests: [], notes: "", onboarded: false };

export const INTERESTS = ["Vegetarian", "Vegan", "Budget-conscious", "Has kids", "Has pets", "Prefers local shops", "Eco-friendly", "Loves to cook", "Travels often"];

const KEY = "open-agent.profile";
const EVENT = "open-agent:profile";

const str = (v: unknown) => (typeof v === "string" ? v : "");

function parse(raw: string | null): Profile {
  if (!raw) return EMPTY_PROFILE;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: str(v.name),
      home: str(v.home),
      interests: Array.isArray(v.interests) ? v.interests.filter((i): i is string => typeof i === "string") : [],
      notes: str(v.notes),
      ...(typeof v.defaultModel === "string" && { defaultModel: v.defaultModel }),
      onboarded: v.onboarded === true,
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadProfile(): Profile {
  return parse(read());
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

let cache: { raw: string | null; value: Profile } | undefined;

function snapshot(): Profile {
  const raw = read();
  if (!cache || cache.raw !== raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY_PROFILE);
}
