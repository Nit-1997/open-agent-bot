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
import { QUIET_ANSWER, TurnView } from "./TurnView";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function ChatSession(props: { agentId: string; threadId: string; locale: string; name?: string; onNewChat: () => void }) {
  const { agent } = useAgent({ agentId: `chat-${props.threadId}`, runtimeAgentId: props.agentId, threadId: props.threadId });
  const { copilotkit } = useCopilotKit();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ kind: RunErrorKind; message?: string } | null>(null);
  const [timing, setTiming] = useState<Record<string, { start: number; end?: number }>>({});
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const reveal = useRef<string | null>(null);
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

  const measure = useCallback(() => {
    const el = scroller.current;
    if (el) setBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  }, []);

  useLayoutEffect(() => {
    const id = reveal.current;
    const mine = id ? document.getElementById(`turn-${id}-user`) : null;
    if (mine) {
      reveal.current = null;
      mine.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
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
    (text: string, quiet = false) => {
      setError(null);
      const id = `${quiet ? QUIET_ANSWER : ""}${crypto.randomUUID()}`;
      if (!quiet) reveal.current = id;
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
          <div id="chat-turns" className="mx-auto w-full max-w-[720px] space-y-6 px-3 pb-6 pt-4 sm:space-y-10 sm:px-4 sm:pb-8 sm:pt-6">
            {turns.map((t) => (
              <div id={`turn-wrap-${t.id}`} key={t.id}>
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
      <div id="chat-footer" className="relative mx-auto w-full max-w-[720px] px-3 pb-3 sm:px-4 sm:pb-4">
        {below && (
          <button
            id="chat-jump-bottom"
            type="button"
            onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: prefersReducedMotion() ? "auto" : "smooth" })}
            className="absolute -top-11 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-paper px-3 text-[12px] font-medium text-text-secondary shadow-float transition hover:text-text-primary focus-visible:outline-2 focus-visible:outline-mist-500"
          >
            <ArrowDown id="chat-jump-bottom-icon" aria-hidden="true" size={14} />
            <span id="chat-jump-bottom-text">{running ? "Reply loading below" : "Latest below"}</span>
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
        <p id="chat-disclaimer" className="mt-1.5 text-center text-[11px] text-text-muted">
          Read-only: I look things up and plan, but never buy, book, or sign in for you.
        </p>
      </div>
    </div>
  );
}
