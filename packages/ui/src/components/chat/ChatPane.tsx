"use client";

import { usePlatformHistory } from "../../platform/index.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentOrb } from "../agent/AgentOrb.tsx";
import { ModelMenu } from "../profile/ModelMenu.tsx";
import { PanelSeparator } from "../reports/PanelSeparator.tsx";
import { type PanelPlacement, ReportPanel } from "../reports/ReportPanel.tsx";
import { useShell } from "../shell/ShellProvider.tsx";
import { ListState } from "../ui/ListState.tsx";
import { ApiError } from "../../lib/api.ts";
import { chatIndex } from "../../lib/chatIndex.ts";
import { cardDates, chatsApi, toHistory } from "../../lib/chats.ts";
import { errorMessage } from "../../lib/errors.ts";
import { isolate, rememberLine } from "../../lib/persona.ts";
import { type ReportRef, sameReports } from "../../lib/reportRefs.ts";
import { type Breakpoint, useBreakpoint } from "../../lib/shell/breakpoints.ts";
import { composerInputId, paneId } from "../../lib/shell/chatController.ts";
import { clampPanel, SEPARATOR_PX } from "../../lib/shell/panelWidth.ts";
import { useReportAutoOpen } from "../../lib/shell/useReportAutoOpen.ts";
import { useReportFocusReturn } from "../../lib/shell/useReportFocusReturn.ts";
import { threadAgentId, useThreadContext } from "../../lib/useThreadContext.ts";
import { getUserContext, withChat } from "../../lib/userContext.ts";
import { ChatHeader } from "./ChatHeader";
import { ChatMissing } from "./ChatMissing";
import { ChatSession } from "./ChatSession";

export const RUNTIME_AGENT_ID = "openagent";
export const REPORT_PLACEHOLDER = "Ask about this report…";

const PANEL_PLACEMENT: Record<Breakpoint, PanelPlacement> = { desktop: "inline", tablet: "overlay", phone: "screen" };

function usePaneWidth(): [(el: HTMLElement | null) => void, number] {
  const [available, setAvailable] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const measure = () => setAvailable(Math.max(0, el.clientWidth - SEPARATOR_PX));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, available];
}

function useHistoryLoader(threadId: string, status: string, attempt: number) {
  const { dispatch } = useShell();
  useEffect(() => {
    if (status !== "loading") return;
    let alive = true;
    Promise.all([chatsApi.get(threadId), chatsApi.messages(threadId)])
      .then(([{ chat }, { items }]) => {
        if (alive)
          dispatch({ type: "loaded", id: threadId, title: chat.title, history: toHistory(threadId, items), cardDates: cardDates(items) });
      })
      .catch((e: unknown) => {
        if (alive) dispatch({ type: "failed", id: threadId, missing: e instanceof ApiError && e.status === 404, error: errorMessage(e) });
      });
    return () => {
      alive = false;
    };
  }, [threadId, status, attempt, dispatch]);
}

export function ChatPane(props: { threadId: string; active: boolean; visible: boolean }) {
  const { threadId, active, visible } = props;
  const shell = useShell();
  const history = usePlatformHistory();
  const { dispatch, persona, profile, models, open, newChat, running, takeFocusRequest, report, overlay } = shell;
  const thread = shell.chats.threads[threadId];
  const panel = shell.chats.panels[threadId];
  const breakpoint = useBreakpoint();
  const id = paneId(threadId);
  const composerId = composerInputId(threadId);
  const context = useMemo(() => getUserContext(), []);
  const value = JSON.stringify(withChat(context, { model: thread?.model }));
  useThreadContext(threadAgentId(threadId), "user_context", value);
  useHistoryLoader(threadId, thread?.status ?? "", thread?.attempt ?? 0);

  const [reports, setReports] = useState<ReportRef[]>([]);
  const [sectionRef, available] = usePaneWidth();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [restored] = useState(() => panel?.reportId ?? null);
  const openTitle = panel ? (reports.find((r) => r.reportId === panel.reportId)?.title ?? "") : "";
  useThreadContext(
    threadAgentId(threadId),
    "open_report",
    panel ? JSON.stringify({ openReport: { id: panel.reportId, title: openTitle } }) : null,
  );

  const activeRef = useRef(active);
  const draftRef = useRef(thread?.status === "draft");
  useEffect(() => {
    draftRef.current = thread?.status === "draft";
  }, [thread?.status]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    if (active && visible && takeFocusRequest("composer")) document.getElementById(composerId)?.focus();
  }, [active, visible, composerId, takeFocusRequest]);

  const onRunningChange = useCallback((r: boolean) => dispatch({ type: "running", id: threadId, running: r }), [dispatch, threadId]);
  const onClaimed = useCallback(
    (firstText: string) => {
      if (!draftRef.current) return;
      dispatch({ type: "claimed", id: threadId, title: firstText });
      chatIndex.addOptimistic(threadId, firstText);
      if (activeRef.current && window.location.pathname === "/") history.replace(null, `/chats/${threadId}`);
    },
    [dispatch, threadId, history],
  );
  const onRunEnd = useCallback(() => void chatIndex.refresh(), []);
  const onReports = useCallback((next: ReportRef[]) => setReports((prev) => (sameReports(prev, next) ? prev : next)), []);
  const onModel = useCallback((model: string) => dispatch({ type: "model", id: threadId, model }), [dispatch, threadId]);
  const openProfile = useCallback(() => open("profile"), [open]);
  const manageModels = useCallback(() => open("models"), [open]);

  const showPanel = !!panel && (thread?.status === "ready" || thread?.status === "draft");
  const shownId = showPanel ? panel.reportId : null;
  const focusTitleNext = useReportFocusReturn({ shownId, paneId: id, composerId, active, visible, reports, titleRef });
  const openReport = report.open;
  const closeReport = report.close;
  const openId = panel?.reportId;
  const onOpenReport = useCallback(
    (reportId: string) => {
      if (openId === reportId) return;
      focusTitleNext();
      openReport(threadId, reportId, "user");
    },
    [openReport, threadId, focusTitleNext, openId],
  );
  const onSwap = useCallback((reportId: string) => openReport(threadId, reportId, "user"), [openReport, threadId]);
  const onClose = useCallback(() => closeReport(threadId), [closeReport, threadId]);
  const { onReportReady, status } = useReportAutoOpen(threadId, { active, visible, breakpoint, overlay });

  if (!thread) return null;
  const phone = breakpoint === "phone";
  const emptyDraft = thread.status === "draft" && !thread.used;
  const showHeader = !phone && !emptyDraft;
  const placement = PANEL_PLACEMENT[breakpoint];
  const inline = showPanel && placement === "inline";
  const panelId = `${id}-report-panel`;
  const backdropId = `${id}-report-backdrop`;
  const statusId = `${id}-report-status`;

  return (
    <section
      id={id}
      ref={sectionRef}
      aria-label={thread.title.trim() || "Chat"}
      hidden={!active}
      inert={!active}
      className="flex min-h-0 flex-1 flex-row"
    >
      <div id={`${id}-column`} className={`flex min-h-0 min-w-0 flex-1 flex-col ${inline ? "min-w-[360px]" : ""}`}>
        {thread.status === "loading" && (
          <>
            {!phone && <div id={`${id}-header-skeleton`} className="h-16 shrink-0 border-b border-surface-accent" aria-hidden="true" />}
            <div id={`${id}-loading`} aria-busy="true" className="flex flex-1 flex-col items-center justify-center gap-3">
              <AgentOrb id={`${id}-loading-orb`} look={persona.look} size={40} breathing />
              <p id={`${id}-loading-text`} className="text-sm text-text-muted">
                Opening chat…
              </p>
            </div>
          </>
        )}
        {thread.status === "missing" && <ChatMissing id={`${id}-missing`} onNewChat={newChat} />}
        {thread.status === "error" && (
          <div id={`${id}-failed`} className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center px-4">
            <ListState
              id={`${id}-failed-state`}
              state={{
                kind: "error",
                message: `Couldn't open this chat: ${thread.error ?? "unknown error"}`,
                onRetry: () => dispatch({ type: "retry", id: threadId }),
              }}
            />
          </div>
        )}
        {(thread.status === "draft" || thread.status === "ready") && (
          <>
            {showHeader && <ChatHeader id={`${id}-header`} title={thread.title} running={running.has(threadId)} persona={persona} />}
            <ChatSession
              id={id}
              agentId={RUNTIME_AGENT_ID}
              threadId={threadId}
              locale={context.locale}
              name={profile.name}
              persona={persona}
              draft={thread.starter}
              history={thread.history}
              shownAt={thread.cardDates}
              autoFocus={active}
              emptyHeading={showHeader ? "h2" : "h1"}
              memory={rememberLine(profile, persona.name)}
              onOpenProfile={openProfile}
              composerPlaceholder={
                panel
                  ? REPORT_PLACEHOLDER
                  : phone
                    ? `Message ${isolate(persona.name)}`
                    : `Ask ${isolate(persona.name)} to research, compare, or plan…`
              }
              composerLabel={`Message ${isolate(persona.name)}`}
              composerAccessory={
                <ModelMenu id={`${id}-model-menu`} models={models} value={thread.model} onChange={onModel} onManage={manageModels} />
              }
              onRunningChange={onRunningChange}
              onClaimed={onClaimed}
              onRunEnd={onRunEnd}
              openReportId={panel?.reportId ?? null}
              reportHint={breakpoint === "desktop" ? "right" : "tap"}
              onOpenReport={onOpenReport}
              onReports={onReports}
              onReportReady={onReportReady}
            />
          </>
        )}
      </div>
      {inline ? (
        <PanelSeparator
          id={`${id}-report-separator`}
          panelId={panelId}
          fraction={report.width}
          available={available}
          onChange={report.setWidth}
        />
      ) : null}
      {showPanel && placement === "overlay" ? (
        <div id={backdropId} aria-hidden="true" onClick={onClose} className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px]" />
      ) : null}
      {showPanel ? (
        <ReportPanel
          id={panelId}
          chatId={threadId}
          reportId={panel.reportId}
          reports={reports}
          placement={placement}
          modalActive={active && visible && placement !== "inline"}
          width={inline ? clampPanel(report.width, available) : undefined}
          guardFocus={panel.how !== "user" || restored === panel.reportId}
          composerId={composerId}
          backdropId={backdropId}
          statusId={statusId}
          titleRef={titleRef}
          onOpen={onSwap}
          onClose={onClose}
        />
      ) : null}
      <p id={statusId} role="status" className="sr-only">
        {status}
      </p>
    </section>
  );
}
