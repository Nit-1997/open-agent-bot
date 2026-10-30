"use client";

import type { OnboardingOptions, Place } from "@shared/onboarding";
import type { Home } from "@shared/profile";
import { useEffect, useState } from "react";
import { optionsQuery } from "./onboarding";

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { cache: "no-store", signal });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as { places?: Place[] };
  return Array.isArray(body.places) ? body.places : [];
}

export function useOnboardingOptions(home: Home | undefined): OnboardingOptions | null {
  const query = optionsQuery(home, typeof navigator === "undefined" ? undefined : navigator.language);
  const [result, setResult] = useState<{ query: string; options: OnboardingOptions } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/onboarding/options?${query}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<OnboardingOptions>) : null))
      .then((options) => {
        if (alive && options?.rows) setResult({ query, options });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [query]);
  return result?.options ?? null;
}

export const settingsApi = {
  get: async (): Promise<{ braveSearch: boolean }> => {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (!res.ok) throw new Error(`Couldn't load settings (${res.status})`);
    return (await res.json()) as { braveSearch: boolean };
  },
  saveBrave: async (apiKey: string) => {
    const res = await fetch("/api/settings/brave-search/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save the key");
  },
  removeBrave: async () => {
    await fetch("/api/settings/brave-search", { method: "DELETE" });
  },
};
