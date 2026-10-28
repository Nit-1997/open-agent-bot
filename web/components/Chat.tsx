"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { Moon, Plus, Sun, User } from "lucide-react";
import { useCallback, useState } from "react";
import { ChatSession } from "@/components/chat/ChatSession";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { ModelsPanel } from "@/components/profile/ModelsPanel";
import { Onboarding } from "@/components/profile/Onboarding";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { useModels } from "@/lib/models";
import { clearProfile, initials, saveProfile, useProfile } from "@/lib/profile";
import { getUserContext, type UserContext, withChat } from "@/lib/userContext";

export const AGENT_ID = "openagent";

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
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
      className="glass-pill flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition hover:bg-paper hover:text-text-primary"
    >
      <Icon id="theme-toggle-icon" aria-hidden="true" size={16} />
    </button>
  );
}

export function Chat() {
  const profile = useProfile();
  const { list: models, reload: reloadModels } = useModels();
  const [modelsPanel, setModelsPanel] = useState(false);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [userContext, setUserContext] = useState<UserContext>(() => getUserContext());
  const [chatModel, setChatModel] = useState<string | undefined>(undefined);
  const [drawer, setDrawer] = useState(false);

  const model = chatModel ?? profile.defaultModel;

  useAgentContext({
    description: "user_context",
    value: JSON.stringify(withChat(userContext, { model, profile })),
  });

  const startNewChat = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setUserContext(getUserContext());
    setChatModel(undefined);
  }, []);

  if (!profile.onboarded) return <Onboarding models={models} onDone={saveProfile} />;

  return (
    <div id="chat-shell" className="flex h-dvh w-full justify-center p-2 sm:p-4">
      <div id="chat-frame" className="glass flex w-full max-w-[920px] flex-col rounded-[28px] p-1.5 sm:p-2">
        <header id="chat-header" className="flex items-center justify-between gap-2 px-3 py-2">
          <div id="chat-brand" className="flex items-center gap-2.5">
            <span id="chat-brand-orb" aria-hidden="true" className="orb h-6 w-6 shadow-float" />
            <h1 id="chat-title" className="hidden font-display text-[24px] leading-none text-text-primary sm:block">
              Open Agent
            </h1>
          </div>
          <div id="chat-actions" className="flex items-center gap-1.5">
            <ModelMenu models={models} value={model} onChange={setChatModel} onManage={() => setModelsPanel(true)} />
            <ThemeToggle />
            <button
              id="chat-profile-button"
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open profile"
              className="glass-pill flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium text-text-primary transition hover:bg-paper"
            >
              {initials(profile.name) || <User id="chat-profile-icon" aria-hidden="true" size={15} />}
            </button>
            <button
              id="chat-new-button"
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-1.5 rounded-full bg-charcoal px-3.5 py-2 text-[13px] font-medium text-on-charcoal shadow-float transition hover:opacity-85"
            >
              <Plus id="chat-new-icon" aria-hidden="true" size={14} />
              <span id="chat-new-label" className="hidden sm:inline">
                New chat
              </span>
            </button>
          </div>
        </header>
        <main id="chat-main" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-border bg-bg">
          <ChatSession key={threadId} agentId={AGENT_ID} threadId={threadId} locale={userContext.locale} name={profile.name} onNewChat={startNewChat} />
        </main>
      </div>
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
          onManageModels={() => {
            setDrawer(false);
            setModelsPanel(true);
          }}
        />
      )}
      {modelsPanel && <ModelsPanel onClose={() => setModelsPanel(false)} onChanged={reloadModels} />}
    </div>
  );
}

