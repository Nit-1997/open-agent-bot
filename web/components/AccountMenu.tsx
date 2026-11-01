"use client";

import { LogOut, Shield, User, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { SignOutForm } from "@/components/auth/SignOutForm";
import { initials } from "@/lib/profile";
import { useDismiss } from "@/lib/useDismiss";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-text-secondary transition hover:bg-surface hover:text-text-primary";

export function AccountMenu(props: { name?: string; email: string; isAdmin: boolean; onOpenProfile: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);
  const name = props.name?.trim();

  return (
    <div id="account-menu" ref={root} className="relative">
      <button
        id="account-menu-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((o) => !o)}
        className="glass-pill flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-medium text-text-primary transition hover:bg-paper"
      >
        {initials(name) || <User id="account-menu-icon" aria-hidden="true" size={15} />}
      </button>
      {open && (
        <div
          id="account-menu-list"
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-30 mt-2 w-64 animate-rise rounded-2xl border border-border bg-paper p-1.5 shadow-lift"
        >
          <div id="account-menu-who" className="border-b border-border px-2.5 pb-2 pt-1">
            {name && (
              <p id="account-menu-name" className="truncate text-sm font-medium text-text-primary">
                {name}
              </p>
            )}
            <p id="account-menu-email" className="truncate text-xs text-text-muted" title={props.email}>
              {props.email}
            </p>
          </div>
          <div id="account-menu-items" className="py-1">
            <button
              id="account-menu-profile"
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                props.onOpenProfile();
              }}
              className={ITEM}
            >
              <UserRound id="account-menu-profile-icon" aria-hidden="true" size={15} />
              Profile & settings
            </button>
            {props.isAdmin && (
              <Link id="account-menu-admin" href="/admin" role="menuitem" onClick={close} className={ITEM}>
                <Shield id="account-menu-admin-icon" aria-hidden="true" size={15} />
                Admin
              </Link>
            )}
          </div>
          <div id="account-menu-footer" className="border-t border-border pt-1">
            <SignOutForm id="account-menu-signout" scope="local" role="menuitem" className={ITEM}>
              <LogOut id="account-menu-signout-icon" aria-hidden="true" size={15} />
              Sign out
            </SignOutForm>
          </div>
        </div>
      )}
    </div>
  );
}
