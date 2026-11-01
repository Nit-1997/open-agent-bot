"use client";

import type { ReportSummary } from "@shared/lists";
import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArtifactFrame } from "@/components/artifacts/ArtifactFrame";
import { ListState } from "@/components/ui/ListState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { reportPdfHref, reportsApi } from "@/lib/reports";
import { fromChat } from "./ReportRow";

type State =
  | { status: "loading" }
  | { status: "ready"; report: ReportSummary }
  | { status: "missing" }
  | { status: "error"; error: string };

const action =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary";

export function BackLink(props: { id: string; href: string; label: string }) {
  return (
    <Link
      id={props.id}
      href={props.href}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary"
    >
      <ArrowLeft id={`${props.id}-icon`} aria-hidden="true" size={14} />
      {props.label}
    </Link>
  );
}

export function ReportDetail({ reportId }: { reportId: string }) {
  const id = "report-detail";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; value: State } | null>(null);
  const key = `${reportId}:${attempt}`;

  useEffect(() => {
    const ac = new AbortController();
    reportsApi
      .get(reportId, ac.signal)
      .then(({ report }) => setState({ key, value: { status: "ready", report } }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        const missing = e instanceof ApiError && e.status === 404;
        setState({ key, value: missing ? { status: "missing" } : { status: "error", error: errorMessage(e) } });
      });
    return () => ac.abort();
  }, [reportId, key]);

  const current: State = state?.key === key ? state.value : { status: "loading" };
  const back = <BackLink id={`${id}-back`} href="/reports" label="All reports" />;

  return (
    <div id={id} className="flex min-h-0 flex-1 flex-col">
      <div id={`${id}-top`} className="px-4 sm:px-7">
        {current.status === "loading" && (
          <div id={`${id}-loading`} aria-busy="true" className="flex flex-col gap-3 pb-5 pt-6">
            {back}
            <div id={`${id}-loading-title`} className="h-9 w-2/3 animate-pulse rounded-xl bg-surface" />
          </div>
        )}
        {current.status === "missing" && (
          <div id={`${id}-missing`} className="flex flex-col gap-3 py-10">
            {back}
            <h1 id={`${id}-missing-title`} className="font-display text-[28px] text-text-primary">
              This report doesn&apos;t exist or isn&apos;t yours.
            </h1>
          </div>
        )}
        {current.status === "error" && (
          <div id={`${id}-failed`} className="flex flex-col gap-3 py-6">
            {back}
            <ListState
              id={`${id}-error`}
              state={{ kind: "error", message: `Couldn't load this report: ${current.error}`, onRetry: () => setAttempt((a) => a + 1) }}
            />
          </div>
        )}
        {current.status === "ready" && (
          <SectionHeader
            id={`${id}-header`}
            title={current.report.title}
            back={back}
            count={undefined}
            actions={
              <>
                {current.report.chatId ? (
                  <Link
                    id={`${id}-from`}
                    href={`/chats/${current.report.chatId}`}
                    className="max-w-[260px] truncate text-[13px] text-mist-600 hover:underline"
                  >
                    {"From: "}
                    <bdi id={`${id}-from-bdi`}>{fromChat(current.report)}</bdi>
                  </Link>
                ) : (
                  <span id={`${id}-from`} className="text-[13px] text-text-muted">
                    From: Chat deleted
                  </span>
                )}
                <a id={`${id}-pdf`} href={reportPdfHref(current.report.id)} download className={action}>
                  <Download id={`${id}-pdf-icon`} aria-hidden="true" size={13} />
                  Download PDF
                </a>
              </>
            }
          />
        )}
      </div>
      {current.status === "ready" && (
        <div id={`${id}-frame-wrap`} className="min-h-0 flex-1 px-0 pb-0 sm:px-7 sm:pb-6">
          <ArtifactFrame
            id={`${id}-frame`}
            artifactId={current.report.id}
            title={current.report.title}
            className="h-full w-full border-y border-border bg-white sm:rounded-2xl sm:border"
          />
        </div>
      )}
    </div>
  );
}
