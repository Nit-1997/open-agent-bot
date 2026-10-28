"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { Moon, Plus, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChatSession } from "@/components/chat/ChatSession";
import { getUserContext, type UserContext } from "@/lib/userContext";

export const AGENT_ID = "openagent";

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  const Icon = dark ? Sun : Moon;
  return (
    <button
      id="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition hover:bg-surface hover:text-text-primary"
    >
      <Icon id="theme-toggle-icon" aria-hidden="true" size={16} />
    </button>
  );
}

export function Chat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [userContext, setUserContext] = useState<UserContext | null>(null);

  useEffect(() => {
    setThreadId(crypto.randomUUID());
    setUserContext(getUserContext());
  }, []);

  useAgentContext({
    description: "user_context",
    value: userContext ? JSON.stringify(userContext) : "",
  });

  const startNewChat = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setUserContext(getUserContext());
  }, []);

  return (
    <div id="chat-shell" className="flex h-dvh w-full flex-col bg-bg">
      <header id="chat-header" className="flex items-center justify-between px-4 py-3 sm:px-6">
        <div id="chat-brand" className="flex items-center gap-2.5">
          <span id="chat-brand-orb" aria-hidden="true" className="orb h-6 w-6" />
          <h1 id="chat-title" className="font-display text-[22px] leading-none text-text-primary">
            Open Agent
          </h1>
        </div>
        <div id="chat-actions" className="flex items-center gap-1">
          <ThemeToggle />
          <button
            id="chat-new-button"
            type="button"
            onClick={startNewChat}
            className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-charcoal px-3.5 py-2 text-[13px] font-medium text-on-charcoal transition hover:opacity-85"
          >
            <Plus id="chat-new-icon" aria-hidden="true" size={14} />
            New chat
          </button>
        </div>
      </header>
      <main id="chat-main" className="flex min-h-0 flex-1 flex-col">
        {threadId && <ChatSession key={threadId} agentId={AGENT_ID} threadId={threadId} locale={userContext?.locale ?? "en-US"} onNewChat={startNewChat} />}
      </main>
    </div>
  );
}
