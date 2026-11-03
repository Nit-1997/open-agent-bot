"use client";

import type { ReportSummary } from "@oab/shared/lists";
import { hrefFor } from "@oab/shared/routes";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type Ref, useEffect, useState } from "react";
import { ArtifactFrame } from "@/components/artifacts/ArtifactFrame";
import { ListState } from "@/components/ui/ListState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { reportHtmlHref, reportPdfHref, reportsApi } from "@/lib/reports";
import { useBreakpoint } from "@/lib/shell/breakpoints";
import { fromChat } from "./ReportRow";

type State =
  | { status: "loading" }
  | { status: "ready"; report: ReportSummary }
  | { status: "missing" }
  | { status: "error"; error: string };

export type ReportViewerProps = {
  id: string;
  reportId: string;
  variant: "panel" | "screen" | "page";
  fallbackTitle?: string;
  chatId?: string;
  position?: { index: number; total: number } | null;
  onPrev?(): void;
  onNext?(): void;
  onClose?(): void;
  back?: ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
  frameRef?: Ref<HTMLIFrameElement>;
  onFrameLoad?(): void;
};

export function useReportSummary(reportId: string): { state: State; retry(): void } {
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
  return { state: state?.key === key ? state.value : { status: "loading" }, retry: () => setAttempt((a) => a + 1) };
}

const iconButton =
  "flex shrink-0 items-center justify-center text-text-secondary transition hover:bg-surface hover:text-text-primary focus-visible:outline-2 focus-visible:outline-mist-500";
const pageAction =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary";

export function ReportViewer(props: ReportViewerProps) {
  const { state, retry } = useReportSummary(props.reportId);
  return props.variant === "page" ? (
    <PageViewer {...props} state={state} retry={retry} />
  ) : (
    <PanelViewer {...props} state={state} retry={retry} />
  );
}

function PanelViewer({ titleRef, frameRef, ...props }: ReportViewerProps & { state: State; retry(): void }) {
  const { id, reportId, state, variant, onClose, onPrev, onNext, onFrameLoad, retry } = props;
  const screen = variant === "screen";
  const otherChat = state.status === "ready" && props.chatId !== undefined && state.report.chatId !== props.chatId;
  const title = state.status === "ready" ? state.report.title : props.fallbackTitle || "Report";
  const position = state.status === "ready" && !otherChat ? props.position : null;
  const many = !screen && !!position && position.total > 1;
  const kind = many ? `Report · ${position.index + 1} of ${position.total} in this chat` : "Report";
  const first = !position || position.index <= 0;
  const last = !position || position.index >= position.total - 1;
  const size = screen ? "h-11 w-11 rounded-full" : "h-9 w-9 rounded-[10px]";

  return (
    <>
      <header
        id={`${id}-header`}
        className={`flex h-16 shrink-0 items-center border-b border-surface-accent ${screen ? "gap-2 px-2" : "gap-3 pl-5 pr-3.5"}`}
      >
        {screen ? (
          <button id={`${id}-back`} type="button" aria-label="Back to chat" onClick={onClose} className={`${iconButton} ${size}`}>
            <ArrowLeft id={`${id}-back-icon`} aria-hidden="true" size={20} />
          </button>
        ) : (
          <span
            id={`${id}-icon`}
            aria-hidden="true"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-paper text-mist-500"
          >
            <FileText id={`${id}-icon-glyph`} aria-hidden="true" size={15} />
          </span>
        )}
        <div id={`${id}-titles`} aria-busy={state.status === "loading"} className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2
            id={`${id}-title`}
            ref={titleRef}
            tabIndex={-1}
            title={title}
            className={`truncate font-medium text-text-primary outline-none ${screen ? "text-[15px]" : "text-[14px]"}`}
          >
            <bdi id={`${id}-title-bdi`}>{title}</bdi>
          </h2>
          <p
            id={`${id}-position`}
            className={`font-mono uppercase tracking-[0.06em] text-text-faint ${screen ? "text-[10px]" : "text-[11px]"}`}
          >
            {kind}
          </p>
        </div>
        <div id={`${id}-actions`} className="flex shrink-0 items-center gap-1">
          {many && (
            <>
              <button
                id={`${id}-prev`}
                type="button"
                aria-label="Previous report"
                aria-disabled={first}
                onClick={() => !first && onPrev?.()}
                className={`${iconButton} ${size} ${first ? "!text-text-faint hover:!bg-transparent" : ""}`}
              >
                <ChevronLeft id={`${id}-prev-icon`} aria-hidden="true" size={18} />
              </button>
              <button
                id={`${id}-next`}
                type="button"
                aria-label="Next report"
                aria-disabled={last}
                onClick={() => !last && onNext?.()}
                className={`${iconButton} ${size} ${last ? "!text-text-faint hover:!bg-transparent" : ""}`}
              >
                <ChevronRight id={`${id}-next-icon`} aria-hidden="true" size={18} />
              </button>
              <span id={`${id}-divider`} aria-hidden="true" className="mx-1 h-5 w-px bg-paper" />
            </>
          )}
          {screen ? (
            <a id={`${id}-pdf`} href={reportPdfHref(reportId)} download aria-label="Download PDF" className={`${iconButton} ${size}`}>
              <Download id={`${id}-pdf-icon`} aria-hidden="true" size={18} />
            </a>
          ) : (
            <a
              id={`${id}-pdf`}
              href={reportPdfHref(reportId)}
              download
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-[13px] text-text-primary transition hover:border-border-strong focus-visible:outline-2 focus-visible:outline-mist-500"
            >
              <Download id={`${id}-pdf-icon`} aria-hidden="true" size={15} />
              Download PDF
            </a>
          )}
          <a
            id={`${id}-new-tab`}
            href={reportHtmlHref(reportId)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in a new tab"
            title="Open in a new tab"
            className={`${iconButton} ${size}`}
          >
            <ExternalLink id={`${id}-new-tab-icon`} aria-hidden="true" size={screen ? 18 : 16} />
          </a>
          {!screen && (
            <button id={`${id}-close`} type="button" aria-label="Close report" onClick={onClose} className={`${iconButton} ${size}`}>
              <X id={`${id}-close-icon`} aria-hidden="true" size={18} />
            </button>
          )}
        </div>
      </header>
      <div id={`${id}-body`} className={`flex min-h-0 flex-1 flex-col ${screen ? "" : "p-5"}`}>
        {state.status === "loading" && (
          <div
            id={`${id}-loading`}
            aria-busy="true"
            aria-label="Loading the report"
            className={`flex-1 animate-pulse bg-surface ${screen ? "" : "rounded-xl"}`}
          />
        )}
        {state.status === "missing" && (
          <p id={`${id}-missing`} className="m-auto max-w-sm px-6 text-center text-[14px] text-text-secondary">
            This report doesn&apos;t exist or isn&apos;t yours.
          </p>
        )}
        {state.status === "error" && (
          <div id={`${id}-error-wrap`} className="px-4 py-6">
            <ListState id={`${id}-error`} state={{ kind: "error", message: `Couldn't load this report: ${state.error}`, onRetry: retry }} />
          </div>
        )}
        {otherChat && (
          <div id={`${id}-other-chat`} className="m-auto flex max-w-sm flex-col items-center gap-2 px-6 text-center">
            <p id={`${id}-other-chat-text`} className="text-[14px] text-text-secondary">
              This report is from another chat.
            </p>
            <Link
              id={`${id}-other-chat-link`}
              href={`/reports/${reportId}`}
              className="text-[13px] text-mist-600 underline-offset-2 hover:underline"
            >
              Open it in Reports
            </Link>
          </div>
        )}
        {state.status === "ready" && !otherChat && (
          <ArtifactFrame
            id={`${id}-frame`}
            ref={frameRef}
            artifactId={reportId}
            title={state.report.title}
            onLoad={onFrameLoad}
            className={`min-h-0 w-full flex-1 bg-white ${screen ? "" : "rounded-xl"}`}
          />
        )}
      </div>
    </>
  );
}

function PageViewer(props: ReportViewerProps & { state: State; retry(): void }) {
  const { id, state, back } = props;
  const desktop = useBreakpoint() === "desktop";
  return (
    <div id={id} className="flex min-h-0 flex-1 flex-col">
      <div id={`${id}-top`} className="px-4 sm:px-7">
        {state.status === "loading" && (
          <div id={`${id}-loading`} aria-busy="true" className="flex flex-col gap-3 pb-5 pt-6">
            {back}
            <div id={`${id}-loading-title`} className="h-9 w-2/3 animate-pulse rounded-xl bg-surface" />
          </div>
        )}
        {state.status === "missing" && (
          <div id={`${id}-missing`} className="flex flex-col gap-3 py-10">
            {back}
            <h1 id={`${id}-missing-title`} className="font-display text-[28px] text-text-primary">
              This report doesn&apos;t exist or isn&apos;t yours.
            </h1>
          </div>
        )}
        {state.status === "error" && (
          <div id={`${id}-failed`} className="flex flex-col gap-3 py-6">
            {back}
            <ListState
              id={`${id}-error`}
              state={{ kind: "error", message: `Couldn't load this report: ${state.error}`, onRetry: props.retry }}
            />
          </div>
        )}
        {state.status === "ready" && (
          <SectionHeader
            id={`${id}-header`}
            title={state.report.title}
            back={back}
            actions={
              <>
                {state.report.chatId ? (
                  <Link
                    id={`${id}-from`}
                    href={hrefFor({ section: "chat", chatId: state.report.chatId, report: desktop ? state.report.id : null })}
                    className="max-w-[260px] truncate text-[13px] text-mist-600 hover:underline"
                  >
                    {"From: "}
                    <bdi id={`${id}-from-bdi`}>{fromChat(state.report)}</bdi>
                  </Link>
                ) : (
                  <span id={`${id}-from`} className="text-[13px] text-text-muted">
                    From: Chat deleted
                  </span>
                )}
                <a id={`${id}-pdf`} href={reportPdfHref(state.report.id)} download className={pageAction}>
                  <Download id={`${id}-pdf-icon`} aria-hidden="true" size={13} />
                  Download PDF
                </a>
                <a
                  id={`${id}-new-tab`}
                  href={reportHtmlHref(state.report.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={pageAction}
                >
                  <ExternalLink id={`${id}-new-tab-icon`} aria-hidden="true" size={13} />
                  Open in a new tab
                </a>
              </>
            }
          />
        )}
      </div>
      {state.status === "ready" && (
        <div id={`${id}-frame-wrap`} className="min-h-0 flex-1 px-0 pb-0 sm:px-7 sm:pb-6">
          <ArtifactFrame
            id={`${id}-frame`}
            artifactId={state.report.id}
            title={state.report.title}
            className="h-full w-full border-y border-border bg-white sm:rounded-2xl sm:border"
          />
        </div>
      )}
    </div>
  );
}
