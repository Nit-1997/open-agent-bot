"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type ProviderView, providersApi } from "@/lib/providers";
import { ProviderRow } from "./models/ProviderRow";

export function ModelsPanel({ onClose, onChanged, pollMs = 1000 }: { onClose: () => void; onChanged: () => void; pollMs?: number }) {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setProviders(await providersApi.list());
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setLoadError(e.message));
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const section = (kind: ProviderView["kind"], title: string) => (
    <section id={`models-${kind}`} className="space-y-2">
      <h3 id={`models-${kind}-title`} className="eyebrow">
        {title}
      </h3>
      <ul id={`models-${kind}-list`} className="space-y-2">
        {(providers ?? [])
          .filter((p) => p.kind === kind)
          .map((p) => (
            <ProviderRow key={p.id} p={p} refresh={refresh} onChanged={onChanged} pollMs={pollMs} />
          ))}
      </ul>
    </section>
  );

  return (
    <div id="models-panel" className="fixed inset-0 z-50 flex justify-end">
      <button
        id="models-panel-backdrop"
        type="button"
        aria-label="Close models"
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
      />
      <aside
        id="models-panel-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Models"
        className="relative flex h-full w-full max-w-[480px] animate-rise flex-col border-l border-border bg-bg shadow-lift"
      >
        <header id="models-panel-header" className="flex items-start justify-between gap-3 px-6 pt-6">
          <div id="models-panel-titles">
            <h2 id="models-panel-title" className="font-display text-[28px] leading-none text-text-primary">
              Models
            </h2>
            <p id="models-panel-sub" className="mt-2 text-xs text-text-muted">
              Connect providers and pick which models appear in your menu. Keys stay on this machine and are never shown again.
            </p>
          </div>
          <button
            id="models-panel-close"
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-muted transition hover:bg-surface hover:text-text-primary"
          >
            <X id="models-panel-close-icon" aria-hidden="true" size={16} />
          </button>
        </header>
        <div id="models-panel-body" className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {loadError && (
            <p id="models-panel-error" role="alert" className="text-sm text-danger-fg">
              {loadError}
            </p>
          )}
          {!providers && !loadError && (
            <p id="models-panel-loading" className="text-sm text-text-muted">
              Loading providers…
            </p>
          )}
          {providers && (
            <>
              {section("cloud", "Cloud providers")}
              {section("local", "Local and self-hosted")}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
