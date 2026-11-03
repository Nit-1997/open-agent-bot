"use client";

import { EventType } from "@ag-ui/client";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import type { AgentPersona } from "@oab/shared/profile";
import { ArrowDown } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "../ErrorBanner.tsx";
import { errorCodeIn, noteRunFailure } from "../../lib/authState.ts";
import type { HistoryMessage } from "../../lib/chats.ts";
import { classifyRunError, isUserStop, NOT_SAVED_EVENT, notSavedMessage, type RunErrorKind } from "../../lib/errors.ts";
import type { WorkflowStepEvent } from "../../lib/steps.ts";
import { parseArtifactId, REPORT_TOOLS, type ReportRef, reportsIn, reportTitleIn } from "../../lib/reportRefs.ts";
import { buildTurns, type ChatMessage, withWorkflow } from "../../lib/turns.ts";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import type { CartEdits, PlanEdits, WorkspaceEdits } from "@oab/shared/workspace";
import { withCartEdits, withPlanEdits, workspaceContextValue } from "../../lib/workspaceEdits.ts";
import { useAgentMessages } from "../../lib/useAgentMessages.ts";
import { threadAgentId, useThreadContext } from "../../lib/useThreadContext.ts";
import type { BrowserFrame } from "./LiveBrowser";
import { QUIET_ANSWER, TurnView } from "./TurnView";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export type ChatSessionProps = {
  id: string;
  agentId: string;
  threadId: string;
  locale: string;
  name?: string;
  persona: AgentPersona;
  draft?: string;
  history?: HistoryMessage[];
  shownAt?: Readonly<Record<string, string>>;
  composerAccessory?: ReactNode;
  composerPlaceholder: string;
  composerLabel: string;
  autoFocus: boolean;
  emptyHeading: "h1" | "h2";
  memory: string | null;
  onOpenProfile: () => void;
  onRunningChange: (running: boolean) => void;
  onClaimed: (firstText: string) => void;
  onRunEnd: () => void;
  openReportId?: string | null;
  reportHint?: "right" | "tap";
  onOpenReport?: (reportId: string, toolCallId: string) => void;
  onReports?: (reports: ReportRef[]) => void;
  onReportReady?: (ready: ReportReady) => void;
};

export type ReportReady = ReportRef & { tool: string };

export function ChatSession(props: ChatSessionProps) {
  const agentId = threadAgentId(props.threadId);
  const { agent } = useAgent({ agentId, runtimeAgentId: props.agentId, threadId: props.threadId });
  const { copilotkit } = useCopilotKit();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ kind: RunErrorKind; message?: string } | null>(null);
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [timing, setTiming] = useState<Record<string, { start: number; end?: number }>>({});
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const reveal = useRef<string | null>(null);
  const stopRequested = useRef(false);
  const [below, setBelow] = useState(false);

  const [workflow, setWorkflow] = useState<Record<string, WorkflowStepEvent[]>>({});
  const messages = useAgentMessages(agent) as readonly ChatMessage[];
  const turns = useMemo(() => withWorkflow(buildTurns(messages), workflow), [messages, workflow]);
  const running = sending || agent.isRunning;
  const lastId = turns.at(-1)?.id;
  const lastRef = useRef(lastId);
  useEffect(() => {
    lastRef.current = lastId;
  }, [lastId]);
  const [frames, setFrames] = useState<Record<string, BrowserFrame>>({});
  const [edits, setEdits] = useState<WorkspaceEdits>({});
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const onCartEdit = useCallback((cart: CartEdits) => setEdits((e) => withCartEdits(e, cart)), []);
  const onPlanEdit = useCallback((plan: PlanEdits) => setEdits((e) => withPlanEdits(e, plan)), []);
  const latestCart = useMemo(() => {
    for (const t of [...turns].reverse())
      for (const it of [...t.items].reverse())
        if (it.kind === "widget" && (it.widget as { kind?: string } | null)?.kind === "cart") return it.id;
    return undefined;
  }, [turns]);
  const latestPlans = useMemo(() => {
    const latest = new Map<string, string>();
    for (const t of turns)
      for (const it of t.items) {
        const w = it.kind === "widget" ? (it.widget as { kind?: string; entity?: string } | null) : null;
        if (w?.kind === "plan") latest.set(w.entity ?? "", it.id);
      }
    return new Set(latest.values());
  }, [turns]);
  useThreadContext(agentId, "workspace_edits", workspaceContextValue(edits));

  const { onRunningChange, onClaimed, onRunEnd, onReports, onReportReady } = props;
  const reports = useMemo(() => reportsIn(turns), [turns]);
  useEffect(() => {
    onReports?.(reports);
  }, [reports, onReports]);
  const toolCalls = useRef(new Map<string, { name: string; title?: string }>());
  const claim = useRef<{ text: string; waiting: boolean; done: boolean }>({ text: "", waiting: false, done: false });
  useEffect(() => {
    onRunningChange(running);
  }, [running, onRunningChange]);

  const { history } = props;
  useEffect(() => {
    if (history?.length && agent.messages.length === 0) agent.setMessages(history);
  }, [agent, history]);

  useEffect(() => {
    const sub = agent.subscribe({
      onRunStartedEvent: () => {
        if (!claim.current.done) claim.current.waiting = true;
      },
      onEvent: ({ event }) => {
        const c = claim.current;
        if (!c.waiting || event.type === EventType.RUN_STARTED) return;
        c.waiting = false;
        if (event.type === EventType.RUN_ERROR) return;
        c.done = true;
        onClaimed(c.text);
      },
      onCustomEvent: ({ event }) => {
        const id = lastRef.current;
        if (event.name === "browser_frame" && id) setFrames((f) => ({ ...f, [id]: event.value as BrowserFrame }));
        if (event.name === "workflow_step" && id)
          setWorkflow((w) => ({ ...w, [id]: [...(w[id] ?? []), event.value as WorkflowStepEvent] }));
        if (event.name === NOT_SAVED_EVENT) setUnsaved(notSavedMessage(event.value));
      },
      onToolCallStartEvent: ({ event }) => {
        toolCalls.current.set(event.toolCallId, { name: event.toolCallName });
        if (event.toolCallName === "show_widget") setArrived((a) => new Set(a).add(event.toolCallId));
      },
      onToolCallEndEvent: ({ event, toolCallName, toolCallArgs }) => {
        const title = typeof toolCallArgs?.title === "string" ? toolCallArgs.title : undefined;
        toolCalls.current.set(event.toolCallId, { name: toolCallName, title });
      },
      onToolCallResultEvent: ({ event }) => {
        const call = toolCalls.current.get(event.toolCallId);
        const content = typeof event.content === "string" ? event.content : "";
        const reportId = parseArtifactId(content);
        toolCalls.current.delete(event.toolCallId);
        if (!call || !REPORT_TOOLS.has(call.name) || !reportId) return;
        const title = call.title?.trim() || reportTitleIn(content) || "Report";
        onReportReady?.({ reportId, toolCallId: event.toolCallId, title, tool: call.name });
      },
      onRunErrorEvent: ({ event }) => {
        if (isUserStop(stopRequested.current, event)) return;
        const message = `${event.code ?? ""} ${event.message ?? ""}`.trim();
        noteRunFailure(event.code);
        setError({ kind: classifyRunError({ error: new Error(message) }), message: event.message });
      },
    });
    return () => sub.unsubscribe();
  }, [agent, onClaimed, onReportReady]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  }, []);

  useLayoutEffect(() => {
    const id = reveal.current;
    const mine = id ? document.getElementById(`${props.id}-turn-${id}-user`) : null;
    if (mine) {
      reveal.current = null;
      mine.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    measure();
  }, [turns, measure, props.id]);

  const run = useCallback(async () => {
    setSending(true);
    try {
      await copilotkit.runAgent({ agent });
      setEdits({});
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (isUserStop(stopRequested.current, e)) return;
      noteRunFailure(errorCodeIn(e.message));
      setError((prev) => prev ?? { kind: classifyRunError({ error: e }), message: e.message });
    } finally {
      setSending(false);
      onRunEnd();
      const id = lastRef.current;
      if (id) setTiming((t) => (t[id] && !t[id].end ? { ...t, [id]: { ...t[id], end: Date.now() } } : t));
    }
  }, [agent, copilotkit, onRunEnd]);

  const send = useCallback(
    (text: string, quiet = false) => {
      stopRequested.current = false;
      setError(null);
      setUnsaved(null);
      const id = `${quiet ? QUIET_ANSWER : ""}${crypto.randomUUID()}`;
      if (!quiet) reveal.current = id;
      if (!claim.current.done && !claim.current.text) claim.current.text = text;
      setTiming((t) => ({ ...t, [id]: { start: Date.now() } }));
      agent.addMessage({ id, role: "user", content: text });
      void run();
    },
    [agent, run],
  );

  const stop = useCallback(() => {
    stopRequested.current = true;
    void copilotkit.stopAgent({ agent });
  }, [agent, copilotkit]);

  const sid = props.id;
  return (
    <div id={`${sid}-session`} className="flex min-h-0 flex-1 flex-col">
      <div id={`${sid}-scroller`} ref={scroller} onScroll={measure} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {turns.length === 0 ? (
          <EmptyState
            id={`${sid}-empty`}
            name={props.name?.trim().split(/\s+/)[0]}
            persona={props.persona}
            heading={props.emptyHeading}
            memory={props.memory}
            onOpenProfile={props.onOpenProfile}
            onPick={send}
          />
        ) : (
          <div id={`${sid}-turns`} className="mx-auto w-full max-w-[760px] space-y-6 px-3 pb-6 pt-4 sm:space-y-10 sm:px-6 sm:pb-8 sm:pt-7">
            {turns.map((t) => (
              <div id={`${sid}-turn-wrap-${t.id}`} key={t.id}>
                <TurnView
                  idPrefix={sid}
                  turn={t}
                  persona={props.persona}
                  running={running && t.id === lastId}
                  locale={props.locale}
                  startedAt={timing[t.id]?.start}
                  endedAt={timing[t.id]?.end}
                  now={now}
                  answered={t.id !== lastId || running}
                  onAnswer={send}
                  frame={frames[t.id]}
                  latestCart={latestCart}
                  onCartEdit={onCartEdit}
                  latestPlans={latestPlans}
                  onPlanEdit={onPlanEdit}
                  arrived={arrived}
                  shownAt={props.shownAt}
                  openReportId={props.openReportId}
                  reportHint={props.reportHint}
                  onOpenReport={props.onOpenReport}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <div id={`${sid}-footer`} className="relative mx-auto w-full max-w-[760px] px-3 pb-3 sm:px-6 sm:pb-5">
        {below && (
          <button
            id={`${sid}-jump-bottom`}
            type="button"
            onClick={() =>
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" })
            }
            className="absolute -top-11 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-paper px-3 text-[12px] font-medium text-text-secondary shadow-float transition hover:text-text-primary focus-visible:outline-2 focus-visible:outline-mist-500"
          >
            <ArrowDown id={`${sid}-jump-bottom-icon`} aria-hidden="true" size={14} />
            <span id={`${sid}-jump-bottom-text`}>{running ? "Reply loading below" : "Latest below"}</span>
          </button>
        )}
        {unsaved && (
          <p
            id={`${sid}-not-saved`}
            role="status"
            className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-warn-bg px-3 py-2 text-xs text-warn-fg"
          >
            <span id={`${sid}-not-saved-text`}>{unsaved}</span>
            <button id={`${sid}-not-saved-dismiss`} type="button" onClick={() => setUnsaved(null)} className="underline underline-offset-2">
              Dismiss
            </button>
          </p>
        )}
        {error && (
          <ErrorBanner
            id={`${sid}-error`}
            kind={error.kind}
            message={error.message}
            onRetry={() => {
              stopRequested.current = false;
              setError(null);
              void run();
            }}
            onDismiss={() => setError(null)}
          />
        )}
        <Composer
          id={`${sid}-composer`}
          running={running}
          onSend={send}
          onStop={stop}
          autoFocus={props.autoFocus}
          initialText={props.draft}
          accessory={props.composerAccessory}
          placeholder={props.composerPlaceholder}
          label={props.composerLabel}
        />
        <p id={`${sid}-disclaimer`} className="mt-1.5 text-center text-[11px] text-text-muted">
          {`Read-only: ${props.persona.name} looks things up and plans, but never buys, books, or signs in for you.`}
        </p>
      </div>
    </div>
  );
}
