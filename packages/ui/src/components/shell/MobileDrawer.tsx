"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { AgentOrb } from "../agent/AgentOrb.tsx";
import { ChatList } from "../chat/ChatList.tsx";
import { initials } from "../../lib/profile.ts";
import { NewChatButton } from "./NewChatButton";
import { Overlay } from "./Overlay";
import { useShell } from "./ShellProvider";
import { SidebarSearch } from "./SidebarSearch";

export function MobileDrawer() {
  const { persona, profile, user, close, open } = useShell();
  const name = profile.name?.trim() || user.name || user.email;
  return (
    <Overlay
      id="mobile-drawer"
      label="Chats"
      side="left"
      onClose={close}
      initialFocus="mobile-drawer-close"
      panelClassName="gap-4 border-r border-surface-accent bg-sidebar px-3.5 pb-[calc(18px+env(safe-area-inset-bottom))] pt-[calc(18px+env(safe-area-inset-top))]"
    >
      <div id="mobile-drawer-header" className="flex items-center gap-2.5 px-1.5 pb-2 pt-1">
        <AgentOrb id="mobile-drawer-orb" look={persona.look} name={persona.name} size={40} />
        <div id="mobile-drawer-who" className="flex min-w-0 flex-col gap-0.5">
          <span id="mobile-drawer-name" className="truncate font-display text-[22px] leading-none text-text-primary">
            <bdi id="mobile-drawer-name-bdi">{persona.name}</bdi>
          </span>
          <span id="mobile-drawer-sub" className="text-[12px] text-text-muted">
            Your agent
          </span>
        </div>
        <button
          id="mobile-drawer-close"
          type="button"
          aria-label="Close chats"
          onClick={close}
          className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition hover:text-text-primary"
        >
          <X id="mobile-drawer-close-icon" aria-hidden="true" size={20} />
        </button>
      </div>
      <SidebarSearch id="mobile-drawer-search" placeholder="Search chats and reports" large />
      <NewChatButton id="mobile-drawer-new-chat" variant="row" onDone={close} />
      <div id="mobile-drawer-scroll" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <ChatList id="chat-list-drawer" variant="drawer" onNavigate={close} />
      </div>
      <div id="mobile-drawer-footer" className="flex flex-col gap-0.5 border-t border-surface-accent pt-2.5">
        <button
          id="mobile-drawer-models"
          type="button"
          onClick={() => open("models")}
          className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 text-[15px] text-text-secondary transition hover:bg-surface hover:text-text-primary"
        >
          <SlidersHorizontal id="mobile-drawer-models-icon" aria-hidden="true" size={18} />
          Models and keys
        </button>
        <button
          id="mobile-drawer-profile"
          type="button"
          onClick={() => open("account")}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface"
        >
          <span
            id="mobile-drawer-profile-initials"
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-accent text-[12px] font-semibold text-text-primary"
          >
            {initials(profile.name?.trim() || user.name) || "?"}
          </span>
          <span id="mobile-drawer-profile-text" className="flex min-w-0 flex-col">
            <span id="mobile-drawer-profile-name" className="truncate text-[14px] font-medium text-text-primary">
              {name}
            </span>
            <span id="mobile-drawer-profile-sub" className="truncate text-[12px] text-text-muted">
              {"Profile, "}
              <bdi id="mobile-drawer-profile-agent">{persona.name}</bdi>
              {", sign out"}
            </span>
          </span>
        </button>
      </div>
    </Overlay>
  );
}
