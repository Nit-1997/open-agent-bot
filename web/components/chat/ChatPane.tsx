"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { useShell } from "@/components/shell/ShellProvider";
import { ListState } from "@/components/ui/ListState";
import { ApiError } from "@/lib/api";
import { chatIndex } from "@/lib/chatIndex";
import { chatsApi, toHistory } from "@/lib/chats";
import { errorMessage } from "@/lib/errors";
import { isolate, rememberLine } from "@/lib/persona";
import { useBreakpoint } from "@/lib/shell/breakpoints";
import { threadAgentId, useThreadContext } from "@/lib/useThreadContext";
import { getUserContext, withChat } from "@/lib/userContext";
import { ChatHeader } from "./ChatHeader";
import { ChatMissing } from "./ChatMissing";
import { ChatSession } from "./ChatSession";

export const RUNTIME_AGENT_ID = "openagent";

export const paneId = (threadId: string) => `chat-pane-${threadId}`;

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

export function ChatPane(props: { threadId: string; active: boolean }) {
  const { threadId, active } = props;
  const shell = useShell();
  const { dispatch, persona, profile, models, open, newChat, running, takeFocusRequest } = shell;
  const thread = shell.chats.threads[threadId];
  const breakpoint = useBreakpoint();
  const id = paneId(threadId);
  const context = useMemo(() => getUserContext(), []);
  const value = JSON.stringify(withChat(context, { model: thread?.model }));
  useThreadContext(threadAgentId(threadId), "user_context", value);
  useHistoryLoader(threadId, thread?.status ?? "", thread?.attempt ?? 0);

  const activeRef = useRef(active);
  const draftRef = useRef(thread?.status === "draft");
  useEffect(() => {
    draftRef.current = thread?.status === "draft";
  }, [thread?.status]);
  useEffect(() => {
    activeRef.current = active;
    if (active && takeFocusRequest("composer")) document.getElementById(`${id}-composer-input`)?.focus();
  }, [active, id, takeFocusRequest]);

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

  if (!thread) return null;
  const phone = breakpoint === "phone";
  const emptyDraft = thread.status === "draft" && !thread.used;
  const showHeader = !phone && !emptyDraft;

  return (
    <section id={id} aria-label={thread.title.trim() || "Chat"} hidden={!active} inert={!active} className="flex min-h-0 flex-1 flex-col">
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
            composerPlaceholder={phone ? `Message ${isolate(persona.name)}` : `Ask ${isolate(persona.name)} to research, compare, or plan…`}
            composerLabel={`Message ${isolate(persona.name)}`}
            composerAccessory={
              <ModelMenu id={`${id}-model-menu`} models={models} value={thread.model} onChange={onModel} onManage={manageModels} />
            }
            onRunningChange={onRunningChange}
            onClaimed={onClaimed}
            onRunEnd={onRunEnd}
          />
        </>
      )}
    </section>
  );
}
