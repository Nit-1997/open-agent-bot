"use client";

import type { PlanSummary, PlansResponse } from "@shared/lists";
import { hrefFor } from "@shared/routes";
import type { EntityKind } from "@shared/workspace";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { ListState } from "@/components/ui/ListState";
import { Pager } from "@/components/ui/Pager";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SectionPage } from "@/components/ui/SectionPage";
import { plansApi } from "@/lib/plans";
import { usePageNav } from "@/lib/shell/usePageNav";
import { usePagedList } from "@/lib/usePagedList";
import { KIND_LABEL, PlanKindFilter } from "./PlanKindFilter";
import { PlanRow } from "./PlanRow";

export function PlansView({ page, kind }: { page: number; kind: EntityKind | null }) {
  const id = "plans";
  const router = useRouter();
  const { persona } = useShell();
  const nav = usePageNav(useCallback((p: number) => ({ section: "plans" as const, page: p, kind }), [kind]));
  const fetchPage = useCallback((p: number, signal: AbortSignal) => plansApi.page(p, kind, signal), [kind]);
  const list = usePagedList<PlanSummary, PlansResponse>({ key: `plans:${kind ?? "all"}`, page, fetchPage, onPastEnd: nav.replace });
  const setKind = (next: EntityKind | null) => router.replace(hrefFor({ section: "plans", page: 1, kind: next }));
  const data = list.data;
  const empty = kind ? (
    <>
      {`No ${KIND_LABEL[kind].one}s yet. `}
      <button id={`${id}-show-all`} type="button" onClick={() => setKind(null)} className="text-mist-600 underline underline-offset-2">
        Show all plans
      </button>
    </>
  ) : (
    `No plans yet. Carts, trips, events and shortlists ${persona.name} saves in chats show up here.`
  );
  return (
    <SectionPage id={id}>
      <SectionHeader
        id={`${id}-header`}
        title="Plans and carts"
        count={data ? `${data.counts.all} ${data.counts.all === 1 ? "plan" : "plans"}` : undefined}
      />
      <PlanKindFilter id={`${id}-filter`} value={kind} counts={data?.counts} onChange={setKind} />
      {list.status === "error" && (
        <ListState id={`${id}-error`} state={{ kind: "error", message: `Couldn't load plans: ${list.error}`, onRetry: list.retry }} />
      )}
      {list.status === "loading" && !data && <ListState id={`${id}-loading`} state={{ kind: "loading", rows: 4 }} />}
      {data && data.total === 0 && <ListState id={`${id}-empty`} state={{ kind: "empty", children: empty }} />}
      {data && data.items.length > 0 && (
        <>
          <ul id={`${id}-list`} aria-busy={list.status === "loading"} className="flex flex-col gap-2.5">
            {data.items.map((p) => (
              <PlanRow key={`${p.chatId}-${p.kind}-${p.key}`} id={`${id}-row-${p.chatId}-${p.kind}-${p.key}`} plan={p} />
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
