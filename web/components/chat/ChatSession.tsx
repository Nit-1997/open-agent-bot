"use client";

import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { classifyRunError, type RunErrorKind } from "@/lib/errors";
import { buildTurns, type ChatMessage } from "@/lib/turns";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { TurnView } from "./TurnView";

export function ChatSession(props: { agentId: string; threadId: string; locale: string; onNewChat: () => void }) {
  const { agent } = useAgent({ agentId: `chat-${props.threadId}`, runtimeAgentId: props.agentId, threadId: props.threadId });
  const { copilotkit } = useCopilotKit();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ kind: RunErrorKind; message?: string } | null>(null);
  const [timing, setTiming] = useState<Record<string, { start: number; end?: number }>>({});
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const turns = useMemo(() => buildTurns(agent.messages as readonly ChatMessage[]), [agent.messages]);
  const running = sending || agent.isRunning;
  const lastId = turns.at(-1)?.id;

  useEffect(() => {
    const sub = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        const message = `${event.code ?? ""} ${event.message ?? ""}`.trim();
        setError({ kind: classifyRunError({ error: new Error(message) }), message: event.message });
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (running || !lastId) return;
    setTiming((t) => (t[lastId] && !t[lastId].end ? { ...t, [lastId]: { ...t[lastId], end: Date.now() } } : t));
  }, [running, lastId]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [agent.messages, running]);

  const run = useCallback(async () => {
    setSending(true);
    try {
      await copilotkit.runAgent({ agent });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError((prev) => prev ?? { kind: classifyRunError({ error: e }), message: e.message });
    } finally {
      setSending(false);
    }
  }, [agent, copilotkit]);

  const send = useCallback(
    (text: string) => {
      setError(null);
      const id = crypto.randomUUID();
      pinned.current = true;
      setTiming((t) => ({ ...t, [id]: { start: Date.now() } }));
      agent.addMessage({ id, role: "user", content: text });
      void run();
    },
    [agent, run],
  );

  const stop = useCallback(() => {
    void copilotkit.stopAgent({ agent });
  }, [agent, copilotkit]);

  return (
    <div id="chat-session" className="flex min-h-0 flex-1 flex-col">
      <div
        id="chat-scroller"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {turns.length === 0 ? (
          <EmptyState onPick={send} />
        ) : (
          <div id="chat-turns" className="mx-auto w-full max-w-[720px] space-y-10 px-4 pb-8 pt-6">
            {turns.map((t) => (
              <TurnView
                key={t.id}
                turn={t}
                running={running && t.id === lastId}
                locale={props.locale}
                startedAt={timing[t.id]?.start}
                endedAt={timing[t.id]?.end}
                now={now}
              />
            ))}
          </div>
        )}
      </div>
      <div id="chat-footer" className="mx-auto w-full max-w-[720px] px-4 pb-4">
        {error && (
          <ErrorBanner
            kind={error.kind}
            message={error.message}
            onNewChat={props.onNewChat}
            onRetry={() => {
              setError(null);
              void run();
            }}
            onDismiss={() => setError(null)}
          />
        )}
        <Composer running={running} onSend={send} onStop={stop} autoFocus />
        <p id="chat-disclaimer" className="mt-2 text-center text-[11px] text-text-faint">
          Read-only: I look things up and plan, but never buy, book, or sign in for you.
        </p>
      </div>
    </div>
  );
}
