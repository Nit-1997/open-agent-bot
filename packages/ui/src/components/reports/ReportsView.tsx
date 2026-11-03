"use client";

import type { ReportSummary } from "@oab/shared/lists";
import { useCallback } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { ListState } from "@/components/ui/ListState";
import { Pager } from "@/components/ui/Pager";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SectionPage } from "@/components/ui/SectionPage";
import { reportsApi } from "@/lib/reports";
import { usePageNav } from "@/lib/shell/usePageNav";
import { usePagedList } from "@/lib/usePagedList";
import { ReportRow } from "./ReportRow";

export function ReportsView({ page }: { page: number }) {
  const id = "reports";
  const { persona } = useShell();
  const nav = usePageNav(useCallback((p: number) => ({ section: "reports" as const, page: p }), []));
  const fetchPage = useCallback((p: number, signal: AbortSignal) => reportsApi.page(p, signal), []);
  const list = usePagedList<ReportSummary>({ key: "reports", page, fetchPage, onPastEnd: nav.replace });
  const data = list.data;
  return (
    <SectionPage id={id} wide>
      <SectionHeader
        id={`${id}-header`}
        title="Reports"
        count={data ? `${data.total} ${data.total === 1 ? "report" : "reports"}` : undefined}
      />
      {list.status === "error" && (
        <ListState id={`${id}-error`} state={{ kind: "error", message: `Couldn't load reports: ${list.error}`, onRetry: list.retry }} />
      )}
      {list.status === "loading" && !data && <ListState id={`${id}-loading`} state={{ kind: "loading", rows: 6, shape: "card" }} />}
      {data && data.total === 0 && (
        <ListState
          id={`${id}-empty`}
          state={{
            kind: "empty",
            children: `No reports yet. Ask ${persona.name} for a one-page guide or a printable list and it appears here.`,
          }}
        />
      )}
      {data && data.items.length > 0 && (
        <>
          <ul id={`${id}-grid`} aria-busy={list.status === "loading"} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((r) => (
              <ReportRow key={r.id} id={`${id}-row-${r.id}`} report={r} />
            ))}
          </ul>
          <Pager
            id={`${id}-pager`}
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            busy={list.status === "loading"}
            onPage={nav.push}
          />
        </>
      )}
    </SectionPage>
  );
}
