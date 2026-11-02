"use client";

import { FileText, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { initials } from "@/lib/profile";
import { navSectionOf, useRoute } from "@/lib/shell/useRoute";
import { chatHrefOf } from "./Rail";
import { useShell } from "./ShellProvider";

const TAB = "flex min-h-11 flex-col items-center justify-center gap-[3px] text-[11px] transition";

function Tab(props: { id: string; href: string; label: string; icon: LucideIcon; active: boolean }) {
  const { id, icon: Icon } = props;
  return (
    <Link
      id={id}
      href={props.href}
      aria-current={props.active ? "page" : undefined}
      className={`${TAB} ${props.active ? "text-text-primary" : "text-text-muted hover:text-text-primary"}`}
    >
      <Icon id={`${id}-icon`} aria-hidden="true" size={20} strokeWidth={1.8} />
      {props.label}
    </Link>
  );
}

export function MobileTabs() {
  const shell = useShell();
  const section = navSectionOf(useRoute());
  const name = shell.profile.name?.trim() || shell.user.name;
  return (
    <nav
      id="mobile-tabs"
      aria-label="Main"
      className="grid h-[calc(64px+env(safe-area-inset-bottom))] shrink-0 grid-cols-4 border-t border-surface pb-[env(safe-area-inset-bottom)]"
    >
      <Tab id="mobile-tabs-chat" href={chatHrefOf(shell.chats)} label="Chat" icon={MessageSquare} active={section === "chat"} />
      <Tab id="mobile-tabs-search" href="/search" label="Search" icon={Search} active={section === "search"} />
      <Tab id="mobile-tabs-reports" href="/reports" label="Reports" icon={FileText} active={section === "reports"} />
      <button
        id="mobile-tabs-you"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={shell.overlay === "account"}
        onClick={() => shell.open("account")}
        className={`${TAB} text-text-muted hover:text-text-primary`}
      >
        <span
          id="mobile-tabs-you-initials"
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-accent text-[9px] font-semibold text-text-primary"
        >
          {initials(name) || "?"}
        </span>
        You
      </button>
    </nav>
  );
}
