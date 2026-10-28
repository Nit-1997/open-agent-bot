"use client";

import { useAgent, useAgentContext, useCopilotKit } from "@copilotkit/react-core/v2";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { classifyRunError, type RunErrorKind } from "@/lib/errors";
import { buildTurns, type ChatMessage } from "@/lib/turns";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import type { CartEdits } from "@/components/widgets/CartCard";
import type { BrowserFrame } from "./LiveBrowser";
import { TurnView } from "./TurnView";

export function ChatSession(props: { agentId: string; threadId: string; locale: string; name?: string; onNewChat: () => void }) {
  const { agent } = useAgent({ agentId: `chat-${props.threadId}`, runtimeAgentId: props.agentId, threadId: props.threadId });
  const { copilotkit } = useCopilotKit();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ kind: RunErrorKind; message?: string } | null>(null);
  const [timing, setTiming] = useState<Record<string, { start: number; end?: number }>>({});
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);
  const [viewport, setViewport] = useState(0);
  const [below, setBelow] = useState(false);

  const turns = useMemo(() => buildTurns(agent.messages as readonly ChatMessage[]), [agent.messages]);
  const running = sending || agent.isRunning;
  const lastId = turns.at(-1)?.id;
  const lastRef = useRef(lastId);
  useEffect(() => {
    lastRef.current = lastId;
  }, [lastId]);
  const [frames, setFrames] = useState<Record<string, BrowserFrame>>({});
  const [cartEdits, setCartEdits] = useState<CartEdits | null>(null);
  const latestCart = useMemo(() => {
    for (const t of [...turns].reverse())
      for (const it of [...t.items].reverse()) if (it.kind === "widget" && (it.widget as { kind?: string } | null)?.kind === "cart") return it.id;
    return undefined;
  }, [turns]);
  useAgentContext({ description: "cart_edits", value: cartEdits ? JSON.stringify(cartEdits) : "" });

  useEffect(() => {
    const sub = agent.subscribe({
      onCustomEvent: ({ event }) => {
        const id = lastRef.current;
        if (event.name === "browser_frame" && id) setFrames((f) => ({ ...f, [id]: event.value as BrowserFrame }));
      },
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
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    const id = anchor.current;
    const turn = id ? document.getElementById(`turn-${id}`) : null;
    if (el && turn) {
      anchor.current = null;
      el.scrollTo({ top: turn.offsetTop - 16, behavior: "smooth" });
    }
    measure();
  }, [turns, measure]);

  const run = useCallback(async () => {
    setSending(true);
    try {
      await copilotkit.runAgent({ agent });
      setCartEdits(null);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError((prev) => prev ?? { kind: classifyRunError({ error: e }), message: e.message });
    } finally {
      setSending(false);
      const id = lastRef.current;
      if (id) setTiming((t) => (t[id] && !t[id].end ? { ...t, [id]: { ...t[id], end: Date.now() } } : t));
    }
  }, [agent, copilotkit]);

  const send = useCallback(
    (text: string) => {
      setError(null);
      const id = crypto.randomUUID();
      anchor.current = id;
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
        onScroll={measure}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {turns.length === 0 ? (
          <EmptyState name={props.name?.trim().split(/\s+/)[0]} onPick={send} />
        ) : (
          <div id="chat-turns" className="mx-auto w-full max-w-[720px] space-y-10 px-4 pb-8 pt-6">
            {turns.map((t) => (
              <div id={`turn-wrap-${t.id}`} key={t.id} style={t.id === lastId && viewport ? { minHeight: viewport - 48 } : undefined}>
                <TurnView
                  turn={t}
                  running={running && t.id === lastId}
                  locale={props.locale}
                  startedAt={timing[t.id]?.start}
                  endedAt={timing[t.id]?.end}
                  now={now}
                  answered={t.id !== lastId || running}
                  onAnswer={send}
                  frame={frames[t.id]}
                  latestCart={latestCart}
                  onCartEdit={setCartEdits}
                />
              </div>
            ))}
          </div>
        )}
      </div>
      <div id="chat-footer" className="relative mx-auto w-full max-w-[720px] px-4 pb-4">
        {below && (
          <button
            id="chat-jump-bottom"
            type="button"
            aria-label="Scroll to the latest"
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })}
            className="absolute -top-12 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-paper text-text-secondary shadow-float transition hover:text-text-primary"
          >
            <ArrowDown id="chat-jump-bottom-icon" aria-hidden="true" size={16} />
          </button>
        )}
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
