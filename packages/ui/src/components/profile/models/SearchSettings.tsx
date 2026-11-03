"use client";

import { useEffect, useState } from "react";
import { settingsApi } from "@/lib/onboardingApi";
import { ghost, input, solid } from "./styles";

export function SearchSettings() {
  const [braveSet, setBraveSet] = useState<boolean | null>(null);
  const [hint, setHint] = useState<string | undefined>(undefined);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then((s) => {
        setBraveSet(s.braveSearch);
        setHint(s.braveSearchHint);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const run = async (action: () => Promise<void>, next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setBraveSet(next);
      setHint(next ? (await settingsApi.get()).braveSearchHint : undefined);
      setKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="models-search" className="space-y-2">
      <h3 id="models-search-title" className="eyebrow">
        Web search
      </h3>
      <div id="models-search-brave" className="rounded-2xl border border-border bg-paper p-3">
        <p id="models-search-brave-label" className="text-sm font-medium text-text-primary">
          Brave Search
        </p>
        <p id="models-search-brave-status" className={`text-[11px] ${braveSet ? "text-success-fg" : "text-text-muted"}`}>
          {braveSet
            ? `Connected${hint ? ` · ${hint}` : ""} · used when SearXNG returns nothing`
            : "Optional fallback when SearXNG returns nothing"}
        </p>
        {braveSet === false && (
          <form
            id="models-search-brave-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => settingsApi.saveBrave(key), true);
            }}
            className="mt-3 flex gap-2"
          >
            <input
              id="models-search-brave-input"
              type="password"
              autoComplete="off"
              aria-label="Brave Search API key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your Brave Search API key"
              className={input}
            />
            <button id="models-search-brave-save" type="submit" disabled={busy || !key.trim()} className={solid}>
              Save key
            </button>
          </form>
        )}
        {braveSet && (
          <button
            id="models-search-brave-remove"
            type="button"
            disabled={busy}
            onClick={() => void run(settingsApi.removeBrave, false)}
            className={`${ghost} mt-2`}
          >
            Remove
          </button>
        )}
        {braveSet === false && (
          <a
            id="models-search-brave-link"
            href="https://brave.com/search/api/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block text-[11px] text-mist-600 underline underline-offset-2"
          >
            Get a free key ↗
          </a>
        )}
        {error && (
          <p id="models-search-brave-error" role="alert" className="mt-2 text-xs text-danger-fg">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
