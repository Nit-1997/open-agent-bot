"use client";

import { hrefFor, parseRoute } from "@shared/routes";
import { useEffect, useRef } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import type { ChatAction } from "./chatController";
import { useBreakpoint } from "./breakpoints";

type Seen = { chatId: string | null | undefined; report: string | null; visible: boolean };

const liveReport = (chatId: string): string | null | undefined =>
  window.location.pathname === `/chats/${chatId}` ? new URLSearchParams(window.location.search).get("report") : undefined;

function follow(dispatch: (a: ChatAction) => void, chatId: string, report: string | null): void {
  if (report) dispatch({ type: "openReport", id: chatId, reportId: report, how: "url", pushed: window.history.state?.oaReport === report });
  else dispatch({ type: "closeReport", id: chatId });
}

export function useReportUrl(chatId: string | null | undefined, report: string | null, visible: boolean): void {
  const { chats, dispatch } = useShell();
  const breakpoint = useBreakpoint();
  const seen = useRef<Seen>({ chatId: undefined, report: null, visible: false });
  const shown = chatId ? (chats.panels[chatId]?.reportId ?? null) : null;
  const shownRef = useRef(shown);

  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    const prev = seen.current;
    seen.current = { chatId, report, visible };
    if (!visible || !chatId) return;
    const arrival = prev.chatId !== chatId || !prev.visible;
    if (arrival && !report && shown) {
      if (breakpoint !== "desktop") dispatch({ type: "closeReport", id: chatId });
      else if (liveReport(chatId) === null) window.history.replaceState(null, "", hrefFor({ section: "chat", chatId, report: shown }));
      return;
    }
    if (!arrival && report === prev.report) return;
    if (report === shown || liveReport(chatId) === shown) return;
    follow(dispatch, chatId, report);
  }, [chatId, report, visible, shown, breakpoint, dispatch]);

  useEffect(() => {
    if (!visible || !chatId) return;
    const onPop = () => {
      const route = parseRoute(window.location.pathname, new URLSearchParams(window.location.search));
      if (route?.section !== "chat" || route.chatId !== chatId) return;
      if (route.report === shownRef.current) return;
      follow(dispatch, chatId, route.report);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [chatId, visible, dispatch]);
}
