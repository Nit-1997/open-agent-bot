"use client";

import { hrefFor } from "@shared/routes";
import { useEffect, useRef } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { useBreakpoint } from "./breakpoints";

type Seen = { chatId: string | null | undefined; report: string | null; visible: boolean };

export function useReportUrl(chatId: string | null | undefined, report: string | null, visible: boolean): void {
  const { chats, dispatch } = useShell();
  const breakpoint = useBreakpoint();
  const panels = useRef(chats.panels);
  const desktop = useRef(breakpoint === "desktop");
  const seen = useRef<Seen>({ chatId: undefined, report: null, visible: false });
  useEffect(() => {
    panels.current = chats.panels;
    desktop.current = breakpoint === "desktop";
  });

  useEffect(() => {
    const prev = seen.current;
    seen.current = { chatId, report, visible };
    if (!visible || !chatId) return;
    const shown = panels.current[chatId]?.reportId ?? null;
    const arrival = prev.chatId !== chatId || !prev.visible;
    if (arrival && !report && shown) {
      if (!desktop.current) dispatch({ type: "closeReport", id: chatId });
      else if (window.location.pathname === `/chats/${chatId}`)
        window.history.replaceState(null, "", hrefFor({ section: "chat", chatId, report: shown }));
      return;
    }
    if (!arrival && report === prev.report) return;
    if (report === shown) return;
    if (report) dispatch({ type: "openReport", id: chatId, reportId: report, how: "url" });
    else dispatch({ type: "closeReport", id: chatId });
  }, [chatId, report, visible, dispatch]);
}
