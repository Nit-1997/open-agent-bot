"use client";

import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef } from "react";
import { SHELL_FRAME_ID } from "@/components/shell/Overlay";
import { useShell } from "@/components/shell/ShellProvider";
import type { ReportRef } from "@/lib/reportRefs";
import { inertOutside } from "@/lib/shell/inertOutside";
import { focusables, useFocusTrap } from "@/lib/shell/useFocusTrap";
import { ReportViewer } from "./ReportViewer";

export type PanelPlacement = "inline" | "overlay" | "screen";

const PLACEMENT_CLASS: Record<PanelPlacement, string> = {
  inline: "relative flex min-h-0 min-w-0 shrink-0 flex-col bg-panel",
  overlay:
    "fixed inset-y-0 right-0 z-30 flex w-[min(calc(100vw-68px),880px)] flex-col border-l border-surface-accent bg-panel shadow-lift animate-slide-right",
  screen:
    "fixed inset-0 z-30 flex flex-col bg-panel pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
};

export function ReportPanel(props: {
  id: string;
  chatId: string;
  reportId: string;
  reports: ReportRef[];
  placement: PanelPlacement;
  modalActive: boolean;
  width?: number;
  guardFocus: boolean;
  composerId: string;
  backdropId: string;
  statusId: string;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onOpen: (reportId: string) => void;
  onClose: () => void;
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
    const undo = inertOutside(el, root, [document.getElementById(props.backdropId), document.getElementById(props.statusId)]);
    if (!el.contains(document.activeElement)) titleRef.current?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || overlayRef.current !== "none") return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      undo();
    };
  }, [modalActive, props.backdropId, props.statusId, titleRef]);

  const index = reports.findIndex((r) => r.reportId === reportId);
  const position = index >= 0 ? { index, total: reports.length } : null;
  const fallbackTitle = index >= 0 ? reports[index].title : undefined;

  const setFrame = useCallback((el: HTMLIFrameElement | null) => {
    frame.current = el;
    if (!el) return;
    const markUser = () => {
      userInput.current = true;
    };
    el.addEventListener("pointerover", markUser);
    return () => el.removeEventListener("pointerover", markUser);
  }, []);

  const { guardFocus, composerId } = props;
  const pullBack = useCallback(() => {
    if (!userInput.current && frame.current && document.activeElement === frame.current) document.getElementById(composerId)?.focus();
  }, [composerId]);
  useEffect(() => {
    if (!guardFocus) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onBlur = () => {
      clearTimeout(timer);
      timer = setTimeout(pullBack, 0);
    };
    window.addEventListener("blur", onBlur);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
    };
  }, [guardFocus, pullBack]);
  const onFrameLoad = useCallback(() => {
    if (guardFocus) pullBack();
  }, [guardFocus, pullBack]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    userInput.current = true;
    if (e.key === "Escape" && !modalActive) {
      e.preventDefault();
      onClose();
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
      className={PLACEMENT_CLASS[placement]}
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
        onClose={onClose}
        titleRef={titleRef}
        frameRef={setFrame}
        onFrameLoad={onFrameLoad}
      />
      {modalActive ? (
        <span
          id={`${id}-focus-wrap`}
          tabIndex={0}
          onFocus={() => {
            if (ref.current) focusables(ref.current)[0]?.focus();
          }}
          className="sr-only"
        />
      ) : null}
    </aside>
  );
}
