"use client";

import { type RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

export const modalFocusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden],[inert]"));

export function useModalKeys(panel: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const escape = useRef(onEscape);
  useEffect(() => {
    escape.current = onEscape;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = panel.current;
      if (!root || (e.key !== "Escape" && e.key !== "Tab")) return;
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        escape.current();
        return;
      }
      const items = modalFocusables(root);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [panel]);
}

export function restoreFocus(before: HTMLElement | null): void {
  if (before?.isConnected && !before.closest("[hidden],[inert]")) {
    before.focus();
    return;
  }
  const composer = [...document.querySelectorAll<HTMLElement>('[id$="-composer-input"]')].find((el) => !el.closest("[hidden],[inert]"));
  composer?.focus();
}
