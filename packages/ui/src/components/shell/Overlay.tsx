"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { focusables, useFocusTrap } from "@/lib/shell/useFocusTrap";

export const SHELL_FRAME_ID = "shell-frame";

export type OverlaySide = "left" | "right" | "bottom";

const PANEL: Record<OverlaySide, string> = {
  left: "absolute inset-y-0 left-0 flex w-[min(86vw,340px)] flex-col animate-slide-left",
  right: "absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col animate-slide-right",
  bottom: "absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col animate-slide-up",
};

export function Overlay(props: {
  id: string;
  label: string;
  side: OverlaySide;
  onClose: () => void;
  panelClassName?: string;
  initialFocus?: string;
  children: ReactNode;
}) {
  const { id, onClose, initialFocus } = props;
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true);

  useEffect(() => {
    const frame = document.getElementById(SHELL_FRAME_ID);
    frame?.setAttribute("inert", "");
    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = panel.current;
    const target = (initialFocus && document.getElementById(initialFocus)) || (el && focusables(el)[0]);
    target?.focus();
    return () => {
      frame?.removeAttribute("inert");
      document.body.style.overflow = body;
    };
  }, [initialFocus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div id={id} className="fixed inset-0 z-40">
      <div id={`${id}-backdrop`} aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <div
        id={`${id}-panel`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        className={`${PANEL[props.side]} ${props.panelClassName ?? ""}`}
      >
        {props.children}
      </div>
    </div>
  );
}
