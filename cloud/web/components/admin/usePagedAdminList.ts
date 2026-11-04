"use client";

import type { PageResponse } from "@oab/shared/pages";
import { useState } from "react";
import { type ActionResult, runAction } from "@/lib/actionResult";

type Row = { id: string; email: string };
export type RowError = { email: string; message: string };

export function usePagedAdminList<T extends Row, Q>(opts: {
  initial: ActionResult<PageResponse<T>>;
  initialQuery: Q;
  fetchPage: (query: Q, page: number) => Promise<ActionResult<PageResponse<T>>>;
}) {
  const [query, setQuery] = useState(opts.initialQuery);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(opts.initial);
  const [loading, setLoading] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (nextQuery: Q, nextPage: number) => {
    setLoading(true);
    let target = nextPage;
    let next = await runAction(() => opts.fetchPage(nextQuery, target));
    if (next.ok && next.data.items.length === 0 && target > 1) {
      target = Math.max(1, Math.ceil(next.data.total / next.data.pageSize));
      next = await runAction(() => opts.fetchPage(nextQuery, target));
    }
    setQuery(nextQuery);
    setPage(target);
    setResult(next);
    setLoading(false);
  };

  const act = async <R>(row: T, call: () => Promise<ActionResult<R>>, success: (data: R) => string): Promise<boolean> => {
    setBusyRow(row.id);
    setNotice(null);
    setRowErrors((errors) => Object.fromEntries(Object.entries(errors).filter(([id]) => id !== row.id)));
    const outcome = await runAction(call);
    setBusyRow(null);
    if (outcome.ok) setNotice(success(outcome.data));
    else setRowErrors((errors) => ({ ...errors, [row.id]: { email: row.email, message: outcome.message } }));
    await load(query, page);
    return outcome.ok;
  };

  const visible = new Set(result.ok ? result.data.items.map((r) => r.id) : []);
  const hiddenErrors = Object.entries(rowErrors).filter(([id]) => !visible.has(id));

  return { query, page, result, loading, busyRow, rowErrors, hiddenErrors, notice, load, act };
}
