"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { PanelSeparator } from "@/components/reports/PanelSeparator";
import { type PanelPlacement, ReportPanel } from "@/components/reports/ReportPanel";
import { useShell } from "@/components/shell/ShellProvider";
import { ListState } from "@/components/ui/ListState";
import { widgetId } from "@/components/widgets/widgetId";
import { ApiError } from "@/lib/api";
import { chatIndex } from "@/lib/chatIndex";
import { chatsApi, toHistory } from "@/lib/chats";
import { errorMessage } from "@/lib/errors";
import { isolate, rememberLine } from "@/lib/persona";
import type { ReportRef } from "@/lib/reportRefs";
import { shouldAutoOpen } from "@/lib/shell/autoOpen";
import { type Breakpoint, useBreakpoint } from "@/lib/shell/breakpoints";
import { composerInputId, paneId } from "@/lib/shell/chatController";
import { clampPanel, SEPARATOR_PX } from "@/lib/shell/panelWidth";
import { threadAgentId, useThreadContext } from "@/lib/useThreadContext";
import { getUserContext, withChat } from "@/lib/userContext";
import { ChatHeader } from "./ChatHeader";
import { ChatMissing } from "./ChatMissing";
import { ChatSession, type ReportReady } from "./ChatSession";

export const RUNTIME_AGENT_ID = "openagent";
export const REPORT_PLACEHOLDER = "Ask about this report…";

const PLACEMENT: Record<Breakpoint, PanelPlacement> = { desktop: "inline", tablet: "overlay", phone: "screen" };

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
        if (alive) dispatch({ type: "loaded", id: threadId, title: chat.title, history: toHistory(threadId, items) });
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
  const [status, setStatus] = useState("");
  const [sectionRef, available] = usePaneWidth();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  const [restored] = useState(() => panel?.reportId ?? null);
  const openTitle = panel ? (reports.find((r) => r.reportId === panel.reportId)?.title ?? "") : "";
  useThreadContext(
    threadAgentId(threadId),
    "open_report",
    panel ? JSON.stringify({ openReport: { id: panel.reportId, title: openTitle } }) : null,
  );

  const activeRef = useRef(active);
  const visibleRef = useRef(visible);
  const breakpointRef = useRef(breakpoint);
  const overlayRef = useRef(overlay);
  const chatsRef = useRef(shell.chats);
  const reportsRef = useRef(reports);
  const draftRef = useRef(thread?.status === "draft");
  useEffect(() => {
    draftRef.current = thread?.status === "draft";
  }, [thread?.status]);
  useEffect(() => {
    activeRef.current = active;
    visibleRef.current = visible;
    breakpointRef.current = breakpoint;
    overlayRef.current = overlay;
    chatsRef.current = shell.chats;
    reportsRef.current = reports;
  });
  useEffect(() => {
    if (active && visible && takeFocusRequest("composer")) document.getElementById(composerId)?.focus();
  }, [active, visible, composerId, takeFocusRequest]);

  const onRunningChange = useCallback((r: boolean) => dispatch({ type: "running", id: threadId, running: r }), [dispatch, threadId]);
  const onClaimed = useCallback(
    (firstText: string) => {
      if (!draftRef.current) return;
      dispatch({ type: "claimed", id: threadId, title: firstText });
      chatIndex.addOptimistic(threadId, firstText);
      if (activeRef.current && window.location.pathname === "/") window.history.replaceState(null, "", `/chats/${threadId}`);
    },
    [dispatch, threadId],
  );
  const onRunEnd = useCallback(() => void chatIndex.refresh(), []);
  const onModel = useCallback((model: string) => dispatch({ type: "model", id: threadId, model }), [dispatch, threadId]);
  const openProfile = useCallback(() => open("profile"), [open]);
  const manageModels = useCallback(() => open("models"), [open]);

  const openReport = report.open;
  const closeReport = report.close;
  const onOpenReport = useCallback(
    (reportId: string) => {
      if (chatsRef.current.panels[threadId]?.reportId === reportId) return;
      focusTitle.current = true;
      openReport(threadId, reportId, "user");
    },
    [openReport, threadId],
  );
  const onSwap = useCallback((reportId: string) => openReport(threadId, reportId, "user"), [openReport, threadId]);
  const onClose = useCallback(() => closeReport(threadId), [closeReport, threadId]);
  const onReportReady = useCallback(
    (r: ReportReady) => {
      const state = chatsRef.current;
      const flags = state.threads[threadId]?.runFlags;
      const shown = activeRef.current && visibleRef.current;
      const auto = shouldAutoOpen({
        tool: r.tool,
        reportId: r.reportId,
        active: activeRef.current,
        visible: visibleRef.current,
        breakpoint: breakpointRef.current,
        overlay: overlayRef.current,
        dismissed: !!flags?.dismissed,
        picked: !!flags?.picked,
        panelOpen: !!state.panels[threadId],
      });
      if (auto) {
        openReport(threadId, r.reportId, "auto");
        setStatus(`Opened “${r.title}” on the right.`);
      } else if (shown) setStatus(`Report ready: “${r.title}”.`);
    },
    [openReport, threadId],
  );

  const showPanel = !!panel && (thread?.status === "ready" || thread?.status === "draft");
  const shownId = showPanel ? panel.reportId : null;
  const lastShown = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastShown.current;
    if (prev === shownId) return;
    lastShown.current = shownId;
    if (shownId && focusTitle.current) {
      focusTitle.current = false;
      requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    }
    if (!prev || shownId || !activeRef.current || !visibleRef.current) return;
    requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current && current !== document.body) return;
      const ref = reportsRef.current.find((r) => r.reportId === prev);
      const card = ref && document.getElementById(widgetId("artifact-card", ref.toolCallId, id));
      (card ?? document.getElementById(composerId))?.focus();
    });
  });

  if (!thread) return null;
  const phone = breakpoint === "phone";
  const emptyDraft = thread.status === "draft" && !thread.used;
  const showHeader = !phone && !emptyDraft;
  const placement = PLACEMENT[breakpoint];
  const inline = showPanel && placement === "inline";
  const panelId = `${id}-report-panel`;
  const backdropId = `${id}-report-backdrop`;

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
              autoFocus={active}
              emptyHeading={showHeader ? "h2" : "h1"}
              memory={rememberLine(profile, persona.name)}
              onOpenProfile={openProfile}
              composerPlaceholder={
                panel ? REPORT_PLACEHOLDER : phone ? `Message ${isolate(persona.name)}` : `Ask ${isolate(persona.name)} to research, compare, or plan…`
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
              onReports={setReports}
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
        <div
          id={backdropId}
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[2px]"
        />
      ) : null}
      {showPanel ? (
        <ReportPanel
          id={panelId}
          threadId={threadId}
          chatId={threadId}
          reportId={panel.reportId}
          reports={reports}
          placement={placement}
          modalActive={active && visible && placement !== "inline"}
          width={inline ? clampPanel(report.width, available) : undefined}
          guardFocus={panel.how !== "user" || restored === panel.reportId}
          composerId={composerId}
          backdropId={backdropId}
          titleRef={titleRef}
          onOpen={onSwap}
          onClose={onClose}
        />
      ) : null}
      <p id={`${id}-report-status`} role="status" className="sr-only">
        {status}
      </p>
    </section>
  );
}
