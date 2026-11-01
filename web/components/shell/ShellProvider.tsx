"use client";

import type { AgentPersona, Profile } from "@shared/profile";
import { agentPersona } from "@shared/profile";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useReducer, useRef, useState } from "react";
import type { ModelList } from "@/lib/models";
import { type ChatAction, type ChatState, chatReducer, initialChatState, isUntouchedDraft } from "@/lib/shell/chatController";
import { readSidebarOpen, writeSidebarOpen } from "@/lib/shell/sidebarPref";

export type Overlay = "none" | "sidebar" | "drawer" | "account" | "profile" | "models";
export type FocusTarget = "search" | "composer";
export type ShellUser = { email: string; name: string; isAdmin: boolean };

export type ShellApi = {
  user: ShellUser;
  persona: AgentPersona;
  profile: Profile;
  saveProfile(p: Profile): Promise<void>;
  models: ModelList | null;
  reloadModels(): void;
  chats: ChatState;
  dispatch(a: ChatAction): void;
  newChat(): void;
  sidebar: { open: boolean; toggle(): void };
  overlay: Overlay;
  profileFocus?: "agent";
  open(o: Exclude<Overlay, "none">, opts?: { focus?: "agent" }): void;
  close(): void;
  running: ReadonlySet<string>;
  requestFocus(target: FocusTarget): void;
  takeFocusRequest(target: FocusTarget): boolean;
};

const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const api = useContext(ShellContext);
  if (!api) throw new Error("useShell needs a ShellProvider");
  return api;
}

export function ShellProvider(props: {
  user: ShellUser;
  profile: Profile;
  saveProfile: (p: Profile) => Promise<void>;
  models: ModelList | null;
  reloadModels: () => void;
  starter?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [chats, dispatch] = useReducer(chatReducer, props.starter, (starter) => initialChatState(crypto.randomUUID(), starter));
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [profileFocus, setProfileFocus] = useState<"agent" | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const focusRequests = useRef(new Set<FocusTarget>());

  const requestFocus = useCallback((target: FocusTarget) => {
    focusRequests.current.add(target);
  }, []);
  const takeFocusRequest = useCallback((target: FocusTarget) => focusRequests.current.delete(target), []);

  const open = useCallback(
    (o: Exclude<Overlay, "none">, opts?: { focus?: "agent" }) => {
      if (overlay === "none") opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setProfileFocus(opts?.focus);
      setOverlay(o);
    },
    [overlay],
  );

  const close = useCallback(() => {
    setOverlay("none");
    setProfileFocus(undefined);
    const back = opener.current;
    opener.current = null;
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus();
    });
  }, []);

  const toggle = useCallback(() => {
    setSidebarOpen((was) => {
      writeSidebarOpen(!was);
      return !was;
    });
  }, []);

  const newChat = useCallback(() => {
    const onChat = window.location.pathname === "/";
    if (onChat && isUntouchedDraft(chats.threads[chats.activeId])) {
      focusRequests.current.add("composer");
      document.getElementById(`chat-pane-${chats.activeId}-composer-input`)?.focus();
      return;
    }
    dispatch({ type: "newDraft", id: crypto.randomUUID() });
    focusRequests.current.add("composer");
    router.push("/");
  }, [chats, router]);

  const running = useMemo(() => new Set(chats.running), [chats.running]);
  const persona = useMemo(() => agentPersona(props.profile), [props.profile]);

  const api: ShellApi = {
    user: props.user,
    persona,
    profile: props.profile,
    saveProfile: props.saveProfile,
    models: props.models,
    reloadModels: props.reloadModels,
    chats,
    dispatch,
    newChat,
    sidebar: { open: sidebarOpen, toggle },
    overlay,
    profileFocus,
    open,
    close,
    running,
    requestFocus,
    takeFocusRequest,
  };

  return <ShellContext.Provider value={api}>{props.children}</ShellContext.Provider>;
}
