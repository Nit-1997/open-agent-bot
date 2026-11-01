"use client";

import { FileText, MessageSquare, Plus, Search, SquareCheckBig } from "lucide-react";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { AccountMenu } from "@/components/AccountMenu";
import { SEARCH_INPUT_ID } from "@/lib/shell/searchNav";
import { navSectionOf, useRoute } from "@/lib/shell/useRoute";
import { RailButton, RailLink } from "./RailLink";
import { useShell } from "./ShellProvider";
import { SidebarToggle } from "./SidebarToggle";

export function chatHrefOf(chats: ReturnType<typeof useShell>["chats"]): string {
  const t = chats.threads[chats.activeId];
  return t && t.claimed ? `/chats/${t.id}` : "/";
}

export function Rail(props: { sidebarOpen: boolean; onToggleSidebar: () => void; showNewChat: boolean }) {
  const shell = useShell();
  const { persona, running, newChat, requestFocus } = shell;
  const route = useRoute();
  const section = navSectionOf(route);
  const chatHidden = route?.section !== "chat";
  const working = running.size > 0 && chatHidden;

  return (
    <nav
      id="rail"
      aria-label="Main"
      className="flex w-[68px] shrink-0 flex-col items-center justify-between border-r border-surface-accent bg-bg py-[18px]"
    >
      <div id="rail-top" className="flex flex-col items-center gap-2.5">
        <AgentOrb id="rail-orb" look={persona.look} size={30} className="mb-[18px]" />
        <RailLink
          id="rail-chats"
          href={chatHrefOf(shell.chats)}
          label="Chats"
          icon={MessageSquare}
          active={section === "chat"}
          badge={
            working && (
              <>
                <span id="rail-chats-dot" aria-hidden="true" className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-mist-500" />
                <span id="rail-chats-working" className="sr-only">
                  {`(${persona.name} is working)`}
                </span>
              </>
            )
          }
        />
        <RailLink
          id="rail-search"
          href="/search"
          label="Search"
          icon={Search}
          active={section === "search"}
          onClick={() => (section === "search" ? document.getElementById(SEARCH_INPUT_ID)?.focus() : requestFocus("search"))}
        />
        <RailLink id="rail-reports" href="/reports" label="Reports" icon={FileText} active={section === "reports"} />
        <RailLink id="rail-plans" href="/plans" label="Plans and carts" icon={SquareCheckBig} active={section === "plans"} />
        {props.showNewChat && <RailButton id="rail-new-chat" label="New chat" icon={Plus} onClick={newChat} />}
      </div>
      <div id="rail-bottom" className="flex flex-col items-center gap-3">
        <SidebarToggle id="rail-sidebar-toggle" open={props.sidebarOpen} onToggle={props.onToggleSidebar} />
        <AccountMenu />
      </div>
    </nav>
  );
}
