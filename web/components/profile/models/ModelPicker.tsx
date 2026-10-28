"use client";

import { useEffect, useMemo, useState } from "react";
import { contextLabel, type ProviderModel, type ProviderView, providersApi } from "@/lib/providers";
import { input } from "./styles";

const SEARCH_AFTER = 12;

export function ModelPicker({ p, onSaved }: { p: ProviderView; onSaved: () => void }) {
  const id = `provider-${p.id}-models`;
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    providersApi
      .models(p.id)
      .then(setModels)
      .catch((e: Error) => setError(e.message));
  }, [p.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (models ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
  }, [models, query]);

  const toggle = async (modelId: string) => {
    if (!models) return;
    const next = models.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m));
    setModels(next);
    try {
      await providersApi.setEnabled(p.id, next.filter((m) => m.enabled).map((m) => m.id));
      onSaved();
    } catch (e) {
      setModels(models);
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger-fg">
        {error}
      </p>
    );
  }
  if (!models) {
    return (
      <p id={`${id}-loading`} className="mt-2 text-xs text-text-muted">
        Loading models…
      </p>
    );
  }
  return (
    <div id={id} className="mt-3 space-y-2">
      {models.length > SEARCH_AFTER && (
        <input id={`${id}-search`} aria-label={`Search ${p.label} models`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${models.length} models`} className={input} />
      )}
      <ul id={`${id}-list`} className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {shown.map((m, i) => (
          <li id={`${id}-${i}`} key={m.id}>
            <label id={`${id}-${i}-label`} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-surface">
              <input id={`${id}-${i}-check`} type="checkbox" checked={m.enabled} onChange={() => void toggle(m.id)} className="mt-1 accent-charcoal" />
              <span id={`${id}-${i}-text`} className="min-w-0">
                <span id={`${id}-${i}-name`} className="block text-sm text-text-primary">
                  {m.label}
                </span>
                <span id={`${id}-${i}-meta`} className="flex flex-wrap gap-x-2 text-[11px] text-text-muted">
                  {m.note && <span id={`${id}-${i}-price`}>{m.note}</span>}
                  <span id={`${id}-${i}-context`}>{contextLabel(m.contextWindow)}</span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
