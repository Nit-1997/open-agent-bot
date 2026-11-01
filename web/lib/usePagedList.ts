"use client";

import type { PageResponse } from "@shared/pages";
import { useCallback, useEffect, useState } from "react";
import { pageCount } from "@/lib/pagination";
import { errorMessage } from "@/lib/errors";

export type PagedState<R> = { status: "loading"; data?: R } | { status: "ready"; data: R } | { status: "error"; error: string; data?: R };

export function usePagedList<T, R extends PageResponse<T> = PageResponse<T>>(opts: {
  key: string;
  page: number;
  fetchPage: (page: number, signal: AbortSignal) => Promise<R>;
  onPastEnd?: (lastPage: number) => void;
  enabled?: boolean;
}): PagedState<R> & { retry: () => void } {
  const { key, page, fetchPage, onPastEnd, enabled = true } = opts;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: PagedState<R> } | null>(null);
  const token = `${key}:${page}:${attempt}`;

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    fetchPage(page, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        const last = pageCount(data.pageSize, data.total);
        if (data.items.length === 0 && page > last && onPastEnd) onPastEnd(last);
        setResult({ key: token, state: { status: "ready", data } });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted)
          setResult((prev) => ({ key: token, state: { status: "error", error: errorMessage(e), data: prev?.state.data } }));
      });
    return () => ac.abort();
  }, [token, enabled, fetchPage, page, onPastEnd]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const state: PagedState<R> = result?.key === token ? result.state : { status: "loading", data: result?.state.data };
  return { ...state, retry };
}
