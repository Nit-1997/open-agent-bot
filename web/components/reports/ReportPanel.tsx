"use client";

import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef } from "react";
import { SHELL_FRAME_ID } from "@/components/shell/Overlay";
import { useShell } from "@/components/shell/ShellProvider";
import type { ReportRef } from "@/lib/reportRefs";
import { inertOutside } from "@/lib/shell/inertOutside";
import { useFocusTrap } from "@/lib/shell/useFocusTrap";
import { ReportViewer } from "./ReportViewer";

export type PanelPlacement = "inline" | "overlay" | "screen";
export type CloseHow = "button" | "escape" | "backdrop" | "back";

const FOCUS_GUARD_MS = 3000;

const PLACEMENT: Record<PanelPlacement, string> = {
  inline: "relative flex min-h-0 min-w-0 shrink-0 flex-col bg-panel",
  overlay:
    "fixed inset-y-0 right-0 z-30 flex w-[min(calc(100vw-68px),880px)] flex-col border-l border-surface-accent bg-panel shadow-lift animate-slide-right",
  screen:
    "fixed inset-0 z-30 flex flex-col bg-panel pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
};

export function ReportPanel(props: {
  id: string;
  threadId: string;
  chatId: string;
  reportId: string;
  reports: ReportRef[];
  placement: PanelPlacement;
  modalActive: boolean;
  width?: number;
  guardFocus: boolean;
  composerId: string;
  backdropId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  frameRef?: (el: HTMLIFrameElement | null) => void;
  onOpen: (reportId: string) => void;
  onClose: (how: CloseHow) => void;
}) {
  const { id, reportId, reports, placement, modalActive, onClose, titleRef } = props;
  const shell = useShell();
  const ref = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const userInput = useRef(false);
  const overlayRef = useRef(shell.overlay);
  const closeRef = useRef(onClose);
  useEffect(() => {
    overlayRef.current = shell.overlay;
    closeRef.current = onClose;
  });

  useEffect(() => {
    userInput.current = false;
  }, [reportId]);

  useFocusTrap(ref, modalActive);

  useEffect(() => {
    const el = ref.current;
    const root = document.getElementById(SHELL_FRAME_ID);
    if (!modalActive || !el || !root) return;
    const undo = inertOutside(el, root, [document.getElementById(props.backdropId)]);
    if (!el.contains(document.activeElement)) titleRef.current?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || overlayRef.current !== "none") return;
      e.preventDefault();
      closeRef.current("escape");
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      undo();
    };
  }, [modalActive, props.backdropId, titleRef]);

  const index = reports.findIndex((r) => r.reportId === reportId);
  const position = index >= 0 ? { index, total: reports.length } : null;
  const fallbackTitle = index >= 0 ? reports[index].title : undefined;

  const { frameRef: outerFrameRef } = props;
  const setFrame = useCallback(
    (el: HTMLIFrameElement | null) => {
      frame.current = el;
      outerFrameRef?.(el);
      if (!el) return;
      const markUser = () => {
        userInput.current = true;
      };
      el.addEventListener("pointerover", markUser);
      return () => el.removeEventListener("pointerover", markUser);
    },
    [outerFrameRef],
  );

  const { guardFocus, composerId } = props;
  const onFrameLoad = useCallback(() => {
    if (!guardFocus) return;
    const check = () => {
      if (!userInput.current && frame.current && document.activeElement === frame.current) document.getElementById(composerId)?.focus();
    };
    const onBlur = () => setTimeout(check, 0);
    check();
    window.addEventListener("blur", onBlur);
    setTimeout(() => window.removeEventListener("blur", onBlur), FOCUS_GUARD_MS);
  }, [guardFocus, composerId]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    userInput.current = true;
    if (e.key === "Escape" && !modalActive) {
      e.preventDefault();
      onClose("escape");
    }
  };

  const modal = placement !== "inline";
  return (
    <aside
      id={id}
      ref={ref}
      aria-label={modal ? undefined : "Report"}
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      aria-labelledby={modal ? `${id}-title` : undefined}
      style={placement === "inline" && props.width ? { width: props.width } : undefined}
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        userInput.current = true;
      }}
      className={PLACEMENT[placement]}
    >
      <ReportViewer
        id={id}
        reportId={reportId}
        variant={placement === "screen" ? "screen" : "panel"}
        fallbackTitle={fallbackTitle}
        chatId={props.chatId}
        position={position}
        onPrev={() => index > 0 && props.onOpen(reports[index - 1].reportId)}
        onNext={() => index >= 0 && index < reports.length - 1 && props.onOpen(reports[index + 1].reportId)}
        onClose={() => onClose(placement === "screen" ? "back" : "button")}
        titleRef={titleRef}
        frameRef={setFrame}
        onFrameLoad={onFrameLoad}
      />
    </aside>
  );
}
