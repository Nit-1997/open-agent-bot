"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { Moon, Plus, Sun, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChatSession } from "@/components/chat/ChatSession";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { Onboarding } from "@/components/profile/Onboarding";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { useModels } from "@/lib/models";
import { clearProfile, initials, saveProfile, useProfile } from "@/lib/profile";
import { getUserContext, type UserContext, withChat } from "@/lib/userContext";

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
  const profile = useProfile();
  const models = useModels();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [chatModel, setChatModel] = useState<string | undefined>(undefined);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    setThreadId(crypto.randomUUID());
    setUserContext(getUserContext());
  }, []);

  const model = chatModel ?? profile.defaultModel;

  useAgentContext({
    description: "user_context",
    value: userContext ? JSON.stringify(withChat(userContext, { model, profile })) : "",
  });

  const startNewChat = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setUserContext(getUserContext());
    setChatModel(undefined);
  }, []);

  if (!profile.onboarded) return <Onboarding models={models} onDone={saveProfile} />;

  return (
    <div id="chat-shell" className="flex h-dvh w-full flex-col bg-bg">
      <header id="chat-header" className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div id="chat-brand" className="flex items-center gap-2.5">
          <span id="chat-brand-orb" aria-hidden="true" className="orb h-6 w-6" />
          <h1 id="chat-title" className="hidden font-display text-[22px] leading-none text-text-primary sm:block">
            Open Agent
          </h1>
        </div>
        <div id="chat-actions" className="flex items-center gap-1">
          <ModelMenu models={models} value={model} onChange={setChatModel} />
          <ThemeToggle />
          <button
            id="chat-profile-button"
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open profile"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-cortex-100 text-[13px] font-medium text-cortex-600 transition hover:ring-2 hover:ring-cortex-300"
          >
            {initials(profile.name) || <User id="chat-profile-icon" aria-hidden="true" size={15} />}
          </button>
          <button
            id="chat-new-button"
            type="button"
            onClick={startNewChat}
            className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-charcoal px-3.5 py-2 text-[13px] font-medium text-on-charcoal transition hover:opacity-85"
          >
            <Plus id="chat-new-icon" aria-hidden="true" size={14} />
            <span id="chat-new-label" className="hidden sm:inline">
              New chat
            </span>
          </button>
        </div>
      </header>
      <main id="chat-main" className="flex min-h-0 flex-1 flex-col">
        {threadId && (
          <ChatSession key={threadId} agentId={AGENT_ID} threadId={threadId} locale={userContext?.locale ?? "en-US"} name={profile.name} onNewChat={startNewChat} />
        )}
      </main>
      {drawer && (
        <ProfileDrawer
          profile={profile}
          models={models}
          onClose={() => setDrawer(false)}
          onSave={(p) => {
            saveProfile(p);
            setDrawer(false);
          }}
          onRestart={() => {
            saveProfile({ ...profile, onboarded: false });
            setDrawer(false);
          }}
          onClear={() => {
            clearProfile();
            setDrawer(false);
          }}
        />
      )}
    </div>
  );
}

