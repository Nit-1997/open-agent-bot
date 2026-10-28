"use client";

import { useCallback, useEffect, useState } from "react";

export type ModelOption = { id: string; label: string; provider?: string; note?: string };
export type ModelList = { default: string | null; models: ModelOption[] };

export function normalizeRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.includes("/") ? ref : `litellm/${ref}`;
}

export function useModels(): { list: ModelList | null; reload: () => void } {
  const [list, setList] = useState<ModelList | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/models", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: ModelList | null) => {
        if (alive && v && Array.isArray(v.models)) setList(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [version]);
  return { list, reload: useCallback(() => setVersion((v) => v + 1), []) };
}

export function modelLabel(list: ModelList | null, id: string | undefined): string {
  const ref = normalizeRef(id);
  return list?.models.find((m) => m.id === ref)?.label ?? id ?? "Model";
}
