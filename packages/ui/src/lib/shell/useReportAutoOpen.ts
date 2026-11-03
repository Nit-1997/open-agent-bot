"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportReady } from "@/components/chat/ChatSession";
import { type Overlay, useShell } from "@/components/shell/ShellProvider";
import { shouldAutoOpen } from "./autoOpen";
import type { Breakpoint } from "./breakpoints";

type Live = { active: boolean; visible: boolean; breakpoint: Breakpoint; overlay: Overlay };

export function useReportAutoOpen(threadId: string, live: Live): { onReportReady: (r: ReportReady) => void; status: string } {
  const { chats, report } = useShell();
  const [status, setStatus] = useState("");
  const latest = useRef({ ...live, chats });
  useEffect(() => {
    latest.current = { ...live, chats };
  });
  const openReport = report.open;
  const onReportReady = useCallback(
    (r: ReportReady) => {
      const { active, visible, breakpoint, overlay, chats: state } = latest.current;
      const flags = state.threads[threadId]?.runFlags;
      const auto = shouldAutoOpen({
        tool: r.tool,
        reportId: r.reportId,
        active,
        visible,
        breakpoint,
        overlay,
        dismissed: !!flags?.dismissed,
        picked: !!flags?.picked,
        panelOpen: !!state.panels[threadId],
      });
      if (auto) {
        openReport(threadId, r.reportId, "auto");
        setStatus(`Opened “${r.title}” on the right.`);
      } else if (active && visible) setStatus(`Report ready: “${r.title}”.`);
    },
    [openReport, threadId],
  );
  return { onReportReady, status };
}
