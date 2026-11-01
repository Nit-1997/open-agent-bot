"use client";

import type { AgentPersona, Profile } from "@shared/profile";
import { agentPersona } from "@shared/profile";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ModelList } from "@/lib/models";
import { useBreakpoint } from "@/lib/shell/breakpoints";
import {
  type ChatAction,
  type ChatState,
  chatReducer,
  composerInputId,
  initialChatState,
  isUntouchedDraft,
} from "@/lib/shell/chatController";
import { readSidebarOpen, writeSidebarOpen } from "@/lib/shell/sidebarPref";

export type Overlay = "none" | "sidebar" | "drawer" | "account" | "profile" | "models";
export type FocusTarget = "search" | "composer";
export type ShellUser = { email: string; name: string; isAdmin: boolean };

const FOCUS_PATH: Record<FocusTarget, string> = { search: "/search", composer: "/" };
const BREAKPOINT_OVERLAYS: ReadonlySet<Overlay> = new Set(["sidebar", "drawer"]);

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
  const pathname = usePathname();
  const breakpoint = useBreakpoint();
  const [chats, dispatch] = useReducer(chatReducer, props.starter, (starter) => initialChatState(crypto.randomUUID(), starter));
  const chatsRef = useRef(chats);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [profileFocus, setProfileFocus] = useState<"agent" | undefined>(undefined);
  const [seenBreakpoint, setSeenBreakpoint] = useState(breakpoint);
  const opener = useRef<HTMLElement | null>(null);
  const focusRequest = useRef<FocusTarget | null>(null);

  if (breakpoint !== seenBreakpoint) {
    setSeenBreakpoint(breakpoint);
    if (BREAKPOINT_OVERLAYS.has(overlay)) setOverlay("none");
  }

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    if (focusRequest.current && FOCUS_PATH[focusRequest.current] !== pathname) focusRequest.current = null;
  }, [pathname]);

  const requestFocus = useCallback((target: FocusTarget) => {
    focusRequest.current = target;
  }, []);
  const takeFocusRequest = useCallback((target: FocusTarget) => {
    if (focusRequest.current !== target) return false;
    focusRequest.current = null;
    return true;
  }, []);

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
    const current = chatsRef.current;
    if (window.location.pathname === "/" && isUntouchedDraft(current.threads[current.activeId])) {
      document.getElementById(composerInputId(current.activeId))?.focus();
      return;
    }
    dispatch({ type: "newDraft", id: crypto.randomUUID() });
    focusRequest.current = "composer";
    router.push("/");
  }, [router]);

  const running = useMemo(() => new Set(chats.running), [chats.running]);
  const persona = useMemo(() => agentPersona(props.profile), [props.profile]);
  const { user, profile, saveProfile, models, reloadModels } = props;

  const api = useMemo<ShellApi>(
    () => ({
      user,
      persona,
      profile,
      saveProfile,
      models,
      reloadModels,
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
    }),
    [
      user,
      persona,
      profile,
      saveProfile,
      models,
      reloadModels,
      chats,
      newChat,
      sidebarOpen,
      toggle,
      overlay,
      profileFocus,
      open,
      close,
      running,
      requestFocus,
      takeFocusRequest,
    ],
  );

  return <ShellContext.Provider value={api}>{props.children}</ShellContext.Provider>;
}
