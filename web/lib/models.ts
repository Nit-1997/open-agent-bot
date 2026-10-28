"use client";

import { useEffect, useState } from "react";

export type ModelOption = { id: string; label: string; note?: string };
export type ModelList = { default: string; models: ModelOption[] };

export function useModels(): ModelList | null {
  const [list, setList] = useState<ModelList | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((v: ModelList | null) => {
        if (alive && v && Array.isArray(v.models)) setList(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

export function modelLabel(list: ModelList | null, id: string | undefined): string {
  return list?.models.find((m) => m.id === id)?.label ?? id ?? "Model";
}
