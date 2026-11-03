"use client";

import { api } from "../platform/api.ts";
import type { OnboardingOptions, Place } from "@oab/shared/onboarding";
import type { Home } from "@oab/shared/profile";
import { useEffect, useState } from "react";
import { readApi } from "./api.ts";
import { noteAuthFailure } from "./authState.ts";
import { optionsQuery } from "./onboarding";

export async function searchPlaces(q: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await api().fetch(`/places?q=${encodeURIComponent(q)}`, { cache: "no-store", signal });
  if (!res.ok) {
    noteAuthFailure(res.status, ((await res.json().catch(() => ({}))) as { error?: unknown }).error);
    return [];
  }
  const body = (await res.json().catch(() => ({}))) as { places?: Place[] };
  return Array.isArray(body.places) ? body.places : [];
}

export function useOnboardingOptions(home: Home | undefined): OnboardingOptions | null {
  const query = optionsQuery(home, typeof navigator === "undefined" ? undefined : navigator.language);
  const [result, setResult] = useState<{ query: string; options: OnboardingOptions } | null>(null);
  useEffect(() => {
    let alive = true;
    api()
      .fetch(`/onboarding/options?${query}`, { cache: "no-store" })
      .then((r) => readApi<OnboardingOptions>(r))
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

export type SearchSettingsView = { braveSearch: boolean; braveSearchHint?: string };

export const settingsApi = {
  get: async (): Promise<SearchSettingsView> => readApi<SearchSettingsView>(await api().fetch("/settings", { cache: "no-store" })),
  saveBrave: async (apiKey: string) => {
    await readApi(
      await api().fetch("/settings/brave-search/key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey }),
      }),
    );
  },
  removeBrave: async () => {
    await readApi(await api().fetch("/settings/brave-search", { method: "DELETE" }));
  },
};
