"use client";

import { User } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { AccountMenuItems } from "@/components/shell/AccountMenuItems";
import { useShell } from "@/components/shell/ShellProvider";
import { initials } from "@/lib/profile";
import { useDismiss } from "@/lib/useDismiss";
import { useMenuKeys } from "@/lib/useMenuKeys";

export function AccountMenu() {
  const { user, profile } = useShell();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const name = profile.name?.trim() || user.name;

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);
  const dismiss = useCallback(() => setOpen(false), []);
  useDismiss(root, open, dismiss);
  const onKeyDown = useMenuKeys(list, open, close);

  return (
    <div id="account-menu" ref={root} className="relative">
      <button
        id="account-menu-button"
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "account-menu-list" : undefined}
        aria-label={`Account: ${name || user.email}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface-accent text-[13px] font-semibold text-text-primary transition hover:border-border-strong"
      >
        {initials(name) || <User id="account-menu-icon" aria-hidden="true" size={15} />}
      </button>
      {open && (
        <div
          id="account-menu-list"
          ref={list}
          role="menu"
          aria-label="Account"
          onKeyDown={onKeyDown}
          className="absolute bottom-0 left-full z-50 ml-2 w-64 animate-rise rounded-2xl border border-border bg-paper p-1.5 shadow-lift"
        >
          <AccountMenuItems id="account-menu" variant="menu" onDone={() => close(true)} />
        </div>
      )}
    </div>
  );
}
