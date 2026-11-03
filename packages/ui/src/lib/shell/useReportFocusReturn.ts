"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import { widgetId } from "@/components/widgets/widgetId";
import type { ReportRef } from "@/lib/reportRefs";

export function useReportFocusReturn(opts: {
  shownId: string | null;
  paneId: string;
  composerId: string;
  active: boolean;
  visible: boolean;
  reports: ReportRef[];
  titleRef: RefObject<HTMLHeadingElement | null>;
}): () => void {
  const { shownId, paneId, composerId, active, visible, reports, titleRef } = opts;
  const last = useRef<string | null>(null);
  const focusTitle = useRef(false);
  useEffect(() => {
    const prev = last.current;
    if (prev === shownId) return;
    last.current = shownId;
    if (shownId && focusTitle.current) {
      focusTitle.current = false;
      requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    }
    if (!prev || shownId || !active || !visible) return;
    const ref = reports.find((r) => r.reportId === prev);
    requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current && current !== document.body) return;
      const card = ref && document.getElementById(widgetId("artifact-card", ref.toolCallId, paneId));
      (card ?? document.getElementById(composerId))?.focus();
    });
  }, [shownId, paneId, composerId, active, visible, reports, titleRef]);
  return useCallback(() => {
    focusTitle.current = true;
  }, []);
}
