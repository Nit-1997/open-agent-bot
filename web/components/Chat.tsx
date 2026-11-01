"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { Moon, Plus, Sun } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { AccountMenu } from "@/components/AccountMenu";
import { ChatSession } from "@/components/chat/ChatSession";
import { RecentChats } from "@/components/chat/RecentChats";
import { AccessDisabled, SignedOutBanner } from "@/components/SessionNotices";
import { ModelMenu } from "@/components/profile/ModelMenu";
import { ModelsPanel } from "@/components/profile/ModelsPanel";
import { Onboarding } from "@/components/profile/onboarding/Onboarding";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";
import { useAuthState } from "@/lib/authState";
import type { HistoryMessage } from "@/lib/chats";
import { useModels } from "@/lib/models";
import { clearedProfile, type Profile, saveProfile, useProfile } from "@/lib/profile";
import { getUserContext, type UserContext, withChat } from "@/lib/userContext";

const AGENT_ID = "openagent";

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

function ProfileLoading({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div id="chat-profile-loading" className="flex h-dvh w-full flex-col items-center justify-center gap-3 px-4">
      <span id="chat-profile-loading-orb" aria-hidden="true" className="orb h-10 w-10 animate-breathe" />
      {error ? (
        <>
          <p id="chat-profile-loading-error" role="alert" className="text-sm text-danger-fg">
            {`Couldn't reach the agent: ${error}`}
          </p>
          <button
            id="chat-profile-loading-retry"
            type="button"
            onClick={onRetry}
            className="rounded-full border border-border px-4 py-1.5 text-sm text-text-secondary transition hover:border-border-strong"
          >
            Try again
          </button>
        </>
      ) : (
        <p id="chat-profile-loading-text" className="text-sm text-text-muted">
          Loading…
        </p>
      )}
    </div>
  );
}

export function Chat({ email, name, isAdmin }: { email: string; name: string; isAdmin: boolean }) {
  const authState = useAuthState();
  const { profile: stored, error, reload } = useProfile();
  const profile = useMemo(() => (stored && !stored.name?.trim() && name ? { ...stored, name } : stored), [stored, name]);
  const { list: models, reload: reloadModels } = useModels();
  const [modelsPanel, setModelsPanel] = useState(false);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [userContext, setUserContext] = useState<UserContext>(() => getUserContext());
  const [chatModel, setChatModel] = useState<string | undefined>(undefined);
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryMessage[] | undefined>(undefined);

  useAgentContext({
    description: "user_context",
    value: JSON.stringify(withChat(userContext, { model: chatModel })),
  });

  const startNewChat = useCallback(() => {
    setThreadId(crypto.randomUUID());
    setUserContext(getUserContext());
    setChatModel(undefined);
    setDraft(undefined);
    setHistory(undefined);
  }, []);

  const openChat = useCallback((chatId: string, messages: HistoryMessage[]) => {
    setThreadId(chatId);
    setHistory(messages);
    setDraft(undefined);
    setDrawer(false);
  }, []);

  const save = async (p: Profile) => {
    await saveProfile(p);
    reloadModels();
  };

  if (authState === "account_disabled") return <AccessDisabled />;
  const signedOut = authState === "signed_out" && <SignedOutBanner />;
  if (!profile) {
    return (
      <>
        {signedOut}
        <ProfileLoading error={error} onRetry={reload} />
      </>
    );
  }

  if (!profile.onboardedAt) {
    return (
      <>
        {signedOut}
        <Onboarding
          profile={profile}
          models={models}
          onModelsChanged={reloadModels}
          onDone={async (p, starter) => {
            await save(p);
            setDraft(starter ?? undefined);
          }}
        />
      </>
    );
  }

  return (
    <>
      {signedOut}
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
              <ModelMenu models={models} value={chatModel} onChange={setChatModel} onManage={() => setModelsPanel(true)} />
              <ThemeToggle />
              <AccountMenu name={profile.name} email={email} isAdmin={isAdmin} onOpenProfile={() => setDrawer(true)} />
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
            <ChatSession
              key={threadId}
              agentId={AGENT_ID}
              threadId={threadId}
              locale={userContext.locale}
              name={profile.name}
              draft={draft}
              history={history}
            />
          </main>
        </div>
        {drawer && (
          <ProfileDrawer
            profile={profile}
            models={models}
            onClose={() => setDrawer(false)}
            onSave={async (p) => {
              await save(p);
              setDrawer(false);
            }}
            onRestart={() => {
              void save({ ...profile, onboardedAt: undefined });
              setDrawer(false);
            }}
            onClear={() => {
              void save(clearedProfile(profile));
              setDrawer(false);
            }}
            onManageModels={() => {
              setDrawer(false);
              setModelsPanel(true);
            }}
            recentChats={<RecentChats currentThreadId={threadId} onOpen={openChat} />}
          />
        )}
        {modelsPanel && <ModelsPanel onClose={() => setModelsPanel(false)} onChanged={reloadModels} />}
      </div>
    </>
  );
}
