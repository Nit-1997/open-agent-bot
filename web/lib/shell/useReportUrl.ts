"use client";

import { hrefFor, parseRoute } from "@shared/routes";
import { useEffect, useRef } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { useBreakpoint } from "./breakpoints";

type Seen = { chatId: string | null | undefined; report: string | null; visible: boolean };

export function useReportUrl(chatId: string | null | undefined, report: string | null, visible: boolean): void {
  const { chats, dispatch } = useShell();
  const breakpoint = useBreakpoint();
  const seen = useRef<Seen>({ chatId: undefined, report: null, visible: false });
  const panels = useRef(chats.panels);

  useEffect(() => {
    panels.current = chats.panels;
    const prev = seen.current;
    seen.current = { chatId, report, visible };
    if (!visible || !chatId) return;
    const shown = chats.panels[chatId]?.reportId ?? null;
    const arrival = prev.chatId !== chatId || !prev.visible;
    if (arrival && !report && shown) {
      if (breakpoint !== "desktop") dispatch({ type: "closeReport", id: chatId });
      else if (window.location.pathname === `/chats/${chatId}`)
        window.history.replaceState(null, "", hrefFor({ section: "chat", chatId, report: shown }));
      return;
    }
    if (!arrival && report === prev.report) return;
    if (report === shown) return;
    if (report) dispatch({ type: "openReport", id: chatId, reportId: report, how: "url" });
    else dispatch({ type: "closeReport", id: chatId });
  });

  useEffect(() => {
    if (!visible || !chatId) return;
    const onPop = () => {
      const route = parseRoute(window.location.pathname, new URLSearchParams(window.location.search));
      if (route?.section !== "chat" || route.chatId !== chatId) return;
      const shown = panels.current[chatId]?.reportId ?? null;
      if (route.report === shown) return;
      if (route.report) dispatch({ type: "openReport", id: chatId, reportId: route.report, how: "url" });
      else dispatch({ type: "closeReport", id: chatId });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [chatId, visible, dispatch]);
}
