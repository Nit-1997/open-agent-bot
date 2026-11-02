"use client";

import type { AgentPersona, Profile } from "@shared/profile";
import { agentPersona } from "@shared/profile";
import { hrefFor, parseRoute } from "@shared/routes";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { ModelList } from "@/lib/models";
import { currentBreakpoint, useBreakpoint } from "@/lib/shell/breakpoints";
import {
  type ChatAction,
  type ChatState,
  chatReducer,
  composerInputId,
  initialChatState,
  isUntouchedDraft,
  type PanelHow,
} from "@/lib/shell/chatController";
import { readPanelFraction, writePanelFraction } from "@/lib/shell/reportPanelPref";
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
  sidebar: { open: boolean; inline: boolean; toggle(): void };
  report: ReportApi;
  overlay: Overlay;
  profileFocus?: "agent";
  open(o: Exclude<Overlay, "none">, opts?: { focus?: "agent" }): void;
  close(): void;
  running: ReadonlySet<string>;
  requestFocus(target: FocusTarget): void;
  takeFocusRequest(target: FocusTarget): boolean;
};

export type ReportApi = {
  open(threadId: string, reportId: string, how: PanelHow): void;
  close(threadId: string): void;
  inline: boolean;
  width: number;
  setWidth(fraction: number, commit?: boolean): void;
};

const ShellContext = createContext<ShellApi | null>(null);

const chatPath = (threadId: string) => `/chats/${threadId}`;
const urlReport = () => new URLSearchParams(window.location.search).get("report");

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
  const [panelWidth, setPanelWidth] = useState(readPanelFraction);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [profileFocus, setProfileFocus] = useState<"agent" | undefined>(undefined);
  const [seenBreakpoint, setSeenBreakpoint] = useState(breakpoint);
  const opener = useRef<HTMLElement | null>(null);
  const focusRequest = useRef<FocusTarget | null>(null);

  if (breakpoint !== seenBreakpoint) {
    setSeenBreakpoint(breakpoint);
    if (BREAKPOINT_OVERLAYS.has(overlay)) setOverlay("none");
  }

  useLayoutEffect(() => {
    chatsRef.current = chats;
  });

  const activeThread = chats.threads[chats.activeId];
  const reportInline =
    breakpoint === "desktop" &&
    parseRoute(pathname)?.section === "chat" &&
    !!chats.panels[chats.activeId] &&
    (activeThread?.status === "ready" || activeThread?.status === "draft");
  const sidebarInline = breakpoint === "desktop" && sidebarOpen && !reportInline;
  const [seenInline, setSeenInline] = useState(reportInline);
  if (reportInline !== seenInline) {
    setSeenInline(reportInline);
    if (!reportInline && breakpoint === "desktop" && overlay === "sidebar") setOverlay("none");
  }

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

  const toggleInline = useCallback(() => {
    setSidebarOpen((was) => {
      writeSidebarOpen(!was);
      return !was;
    });
  }, []);
  const toggle = useCallback(() => {
    if (!reportInline) return toggleInline();
    if (overlay === "sidebar") close();
    else open("sidebar");
  }, [reportInline, toggleInline, overlay, open, close]);

  const openReport = useCallback((threadId: string, reportId: string, how: PanelHow) => {
    const s = chatsRef.current;
    const existing = s.panels[threadId];
    const writes = threadId === s.activeId && window.location.pathname === chatPath(threadId);
    const push = writes && currentBreakpoint() === "phone" && !existing?.pushed;
    dispatch({ type: "openReport", id: threadId, reportId, how, pushed: !!existing?.pushed || push });
    if (!writes || (existing?.reportId === reportId && urlReport() === reportId)) return;
    const href = hrefFor({ section: "chat", chatId: threadId, report: reportId });
    if (push) window.history.pushState({ oaReport: reportId }, "", href);
    else window.history.replaceState(null, "", href);
  }, []);

  const closeReport = useCallback((threadId: string) => {
    const s = chatsRef.current;
    const panel = s.panels[threadId];
    if (!panel) return;
    const writes = threadId === s.activeId && window.location.pathname === chatPath(threadId);
    if (writes && panel.pushed && urlReport() === panel.reportId) {
      window.history.back();
      return;
    }
    dispatch({ type: "closeReport", id: threadId });
    if (writes && urlReport() !== null) window.history.replaceState(null, "", chatPath(threadId));
  }, []);

  const setWidth = useCallback((fraction: number, commit = true) => {
    setPanelWidth(fraction);
    if (commit) writePanelFraction(fraction);
  }, []);

  const report = useMemo<ReportApi>(
    () => ({ open: openReport, close: closeReport, inline: reportInline, width: panelWidth, setWidth }),
    [openReport, closeReport, reportInline, panelWidth, setWidth],
  );

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
      sidebar: { open: sidebarOpen, inline: sidebarInline, toggle },
      report,
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
      sidebarInline,
      toggle,
      report,
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
