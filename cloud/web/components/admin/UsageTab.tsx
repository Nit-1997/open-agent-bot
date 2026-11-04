"use client";

import type { PageResponse } from "@oab/shared/pages";
import {
  type AdminUsageDetail,
  type AdminUsageRow,
  type AdminUsageSummary,
  USAGE_FILTERS,
  USAGE_QUERY_MAX,
  type UsageFilter,
} from "@oab/shared/usage";
import { useEffect, useRef, useState } from "react";
import { listUsage, usageDetail, usageSummary } from "@/app/admin/actions";
import { ghost, input } from "@oab/ui/components/profile/models/styles.ts";
import { DetailList } from "@oab/ui/components/ui/DetailList.tsx";
import { pageCount } from "@oab/ui/lib/pagination.ts";
import { formatWhen } from "@oab/ui/lib/chats.ts";
import { type ActionResult, runAction } from "@/lib/actionResult";
import {
  countText,
  detailItems,
  emptyText,
  lastText,
  limitsText,
  pageText,
  SIGNUP_MODE_NOTE,
  signupsText,
  totalsCopy,
  USAGE_FILTER_LABELS,
  USAGE_SEARCH_DEBOUNCE_MS,
  usedText,
} from "@/lib/adminUsage";
import { usePagedAdminList } from "./usePagedAdminList";

const ID = "admin-usage";

type ListQuery = { q: string; filter: UsageFilter };
type Detail = { userId: string; result: ActionResult<AdminUsageDetail> | null };

export function UsageTab(props: {
  summary: ActionResult<AdminUsageSummary>;
  users: ActionResult<PageResponse<AdminUsageRow>>;
  onOpenUser: (email: string) => void;
}) {
  const list = usePagedAdminList<AdminUsageRow, ListQuery>({
    initial: props.users,
    initialQuery: { q: "", filter: "all" },
    fetchPage: (q, page) => listUsage(page, q.q, q.filter),
  });
  const { query, page, result, loading, load } = list;
  const [summary, setSummary] = useState(props.summary);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<AdminUsageRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const detailSeq = useRef(0);

  const go = (next: ListQuery, nextPage: number) => {
    setSelected(null);
    setDetail(null);
    return load(next, nextPage);
  };

  const reloadSummary = async () => {
    setSummaryLoading(true);
    setSummary(await runAction(usageSummary));
    setSummaryLoading(false);
  };

  const showDetail = async (userId: string) => {
    const seq = ++detailSeq.current;
    setDetail({ userId, result: null });
    const loaded = await runAction(() => usageDetail(userId));
    if (seq === detailSeq.current) setDetail({ userId, result: loaded });
  };

  const toggleDetail = (userId: string) => {
    if (detail?.userId === userId) {
      detailSeq.current++;
      setDetail(null);
    } else void showDetail(userId);
  };

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const search = (value: string, filter: UsageFilter) => {
    setDraft(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (value.trim() !== query.q || filter !== query.filter) void go({ q: value.trim(), filter }, 1);
    }, USAGE_SEARCH_DEBOUNCE_MS);
  };

  const changeFilter = (filter: UsageFilter) => {
    clearTimeout(searchTimer.current);
    void go({ q: draft.trim(), filter }, 1);
  };

  const filtered = query.q !== "" || query.filter !== "all";
  const totals = summary.ok ? totalsCopy(summary.data) : null;

  return (
    <section id={ID} aria-label="Usage" className="space-y-4">
      <div id={`${ID}-totals`} aria-busy={summaryLoading} className="space-y-2 rounded-2xl border border-border bg-paper p-3">
        {summary.ok && totals ? (
          <>
            <div id={`${ID}-numbers`} className="flex flex-wrap gap-x-6 gap-y-1">
              {(
                [
                  ["month-total", totals.monthTotal],
                  ["active-users", totals.activeUsers],
                  ["running", totals.running],
                ] as const
              ).map(([key, [label, value]]) => (
                <p id={`${ID}-${key}`} key={key} className="text-[13px] text-text-secondary">
                  <span id={`${ID}-${key}-label`}>{label}</span>{" "}
                  <strong id={`${ID}-${key}-value`} className="font-display text-[18px] text-text-primary">
                    {value}
                  </strong>
                </p>
              ))}
            </div>
            {summary.data.signups && (
              <p id={`${ID}-signups`} className="text-[12px] text-text-secondary">
                {signupsText(summary.data.signups)}
              </p>
            )}
            <p id={`${ID}-limits`} className="text-[12px] text-text-muted">
              {limitsText(summary.data.limits)}
            </p>
            <p
              id={`${ID}-signup-mode`}
              className={`text-[12px] ${summary.data.signupMode === "unknown" ? "text-warn-fg" : "text-text-muted"}`}
            >
              <span id={`${ID}-signup-mode-value`}>{`Signups: ${summary.data.signupMode}`}</span>
              <span id={`${ID}-signup-mode-note`}>{` · ${SIGNUP_MODE_NOTE}`}</span>
            </p>
          </>
        ) : (
          !summary.ok && (
            <div
              id={`${ID}-totals-error`}
              role="alert"
              className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg"
            >
              <span id={`${ID}-totals-error-text`}>{`Couldn't load the totals: ${summary.message}`}</span>
              <button
                id={`${ID}-totals-retry`}
                type="button"
                disabled={summaryLoading}
                onClick={() => void reloadSummary()}
                className={ghost}
              >
                Retry
              </button>
            </div>
          )
        )}
        <button
          id={`${ID}-refresh`}
          type="button"
          disabled={summaryLoading || loading}
          onClick={() => {
            void reloadSummary();
            void go(query, page);
          }}
          className={ghost}
        >
          Refresh
        </button>
      </div>

      <div id={`${ID}-filters`} role="search" className="flex flex-wrap gap-2">
        <label id={`${ID}-search-label`} htmlFor={`${ID}-search`} className="sr-only">
          Search usage by email
        </label>
        <input
          id={`${ID}-search`}
          type="search"
          maxLength={USAGE_QUERY_MAX}
          autoComplete="off"
          value={draft}
          onChange={(e) => search(e.target.value, query.filter)}
          placeholder="Email contains…"
          className={`${input} min-w-0 flex-1`}
        />
        <label id={`${ID}-filter-label`} htmlFor={`${ID}-filter`} className="sr-only">
          Show
        </label>
        <select
          id={`${ID}-filter`}
          value={query.filter}
          disabled={loading}
          onChange={(e) => changeFilter(e.target.value as UsageFilter)}
          className={`${input} w-auto`}
        >
          {USAGE_FILTERS.map((f) => (
            <option id={`${ID}-filter-${f.replace("_", "-")}`} key={f} value={f}>
              {USAGE_FILTER_LABELS[f]}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <div
          id={`${ID}-selection`}
          role="status"
          className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs"
        >
          <span id={`${ID}-selection-text`} className="truncate text-text-secondary">{`Selected: ${selected.email}`}</span>
          <button id={`${ID}-open-user`} type="button" onClick={() => props.onOpenUser(selected.email)} className={ghost}>
            Open in Users
          </button>
        </div>
      )}

      {!result.ok && (
        <div
          id={`${ID}-error`}
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg"
        >
          <span id={`${ID}-error-text`}>{`Couldn't load usage: ${result.message}`}</span>
          <button id={`${ID}-retry`} type="button" disabled={loading} onClick={() => void go(query, page)} className={ghost}>
            Retry
          </button>
        </div>
      )}

      {result.ok && result.data.total === 0 && (
        <p id={`${ID}-empty`} className="text-sm text-text-muted">
          {emptyText(filtered)}
        </p>
      )}

      {result.ok && result.data.total > 0 && (
        <>
          <ul id={`${ID}-list`} aria-busy={loading} className="space-y-2">
            {result.data.items.map((r) => {
              const rowId = `${ID}-row-${r.id}`;
              const open = detail?.userId === r.id;
              const picked = selected?.id === r.id;
              return (
                <li
                  id={rowId}
                  key={r.id}
                  className={`rounded-2xl border bg-paper p-3 ${picked ? "border-border-strong" : "border-border"}`}
                >
                  <div id={`${rowId}-head`} className="flex flex-wrap items-center gap-2">
                    <div id={`${rowId}-who`} className="flex min-w-0 flex-1 items-center gap-2">
                      {r.runningNow && (
                        <span
                          id={`${rowId}-running`}
                          role="img"
                          aria-label="Running now"
                          title="Running now"
                          className="h-2 w-2 shrink-0 rounded-full bg-success-fg"
                        />
                      )}
                      <p id={`${rowId}-email`} className="truncate text-sm font-medium text-text-primary">
                        {r.email}
                      </p>
                    </div>
                    <span id={`${rowId}-used`} className="text-[12px] tabular-nums text-text-secondary">
                      {usedText(r.monthUsed, r.monthLimit)}
                    </span>
                    <span id={`${rowId}-last`} title={formatWhen(r.lastAt)} className="text-[12px] text-text-muted">
                      {lastText(r.lastAt)}
                    </span>
                    <div id={`${rowId}-actions`} className="flex gap-1.5">
                      <button id={`${rowId}-view`} type="button" aria-expanded={open} onClick={() => toggleDetail(r.id)} className={ghost}>
                        View
                      </button>
                      <button
                        id={`${rowId}-select`}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => setSelected(picked ? null : r)}
                        className={ghost}
                      >
                        {picked ? "Selected" : "Select"}
                      </button>
                    </div>
                  </div>
                  {open && detail && (
                    <UsageDetailPanel id={`${ID}-detail-${r.id}`} result={detail.result} onRetry={() => void showDetail(r.id)} />
                  )}
                </li>
              );
            })}
          </ul>
          <nav id={`${ID}-pager`} aria-label="Usage pages" className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <p id={`${ID}-count`} className="text-[12px] text-text-muted">
              {countText(result.data.page, result.data.pageSize, result.data.total)}
            </p>
            <div id={`${ID}-pager-buttons`} className="flex items-center gap-1.5">
              <button
                id={`${ID}-prev`}
                type="button"
                disabled={loading || result.data.page <= 1}
                onClick={() => void go(query, result.data.page - 1)}
                className={ghost}
              >
                Previous
              </button>
              <span id={`${ID}-page`} className="text-[12px] text-text-secondary">
                {pageText(result.data.page, result.data.pageSize, result.data.total)}
              </span>
              <button
                id={`${ID}-next`}
                type="button"
                disabled={loading || result.data.page >= pageCount(result.data.pageSize, result.data.total)}
                onClick={() => void go(query, result.data.page + 1)}
                className={ghost}
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}

function UsageDetailPanel({ id, result, onRetry }: { id: string; result: ActionResult<AdminUsageDetail> | null; onRetry: () => void }) {
  return (
    <div id={id} aria-busy={result === null} className="mt-2">
      {result === null && (
        <p id={`${id}-loading`} className="text-[12px] text-text-muted">
          Loading…
        </p>
      )}
      {result?.ok === false && (
        <div
          id={`${id}-error`}
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg"
        >
          <span id={`${id}-error-text`}>{`Couldn't load this user: ${result.message}`}</span>
          <button id={`${id}-retry`} type="button" onClick={onRetry} className={ghost}>
            Retry
          </button>
        </div>
      )}
      {result?.ok && <DetailList id={`${id}-list`} items={detailItems(result.data)} />}
    </div>
  );
}
