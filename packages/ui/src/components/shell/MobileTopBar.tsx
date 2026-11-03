"use client";

import { Menu, Plus } from "lucide-react";
import { AgentOrb } from "../agent/AgentOrb.tsx";
import { useRoute } from "../../lib/shell/useRoute.ts";
import { useShell } from "./ShellProvider";

const TITLES = {
  chats: "All chats",
  reports: "Reports",
  report: "Reports",
  search: "Search",
  admin: "",
} as const;
const ROUND = "flex h-11 w-11 items-center justify-center rounded-full bg-surface text-text-secondary transition hover:text-text-primary";

export function MobileTopBar() {
  const { persona, overlay, open, newChat } = useShell();
  const route = useRoute();
  const onChat = route?.section === "chat";
  const title = route && route.section !== "chat" ? TITLES[route.section] : "";
  return (
    <header
      id="mobile-topbar"
      className="flex h-[calc(56px+env(safe-area-inset-top))] shrink-0 items-center justify-between px-3.5 pt-[env(safe-area-inset-top)]"
    >
      <button
        id="mobile-topbar-menu"
        type="button"
        aria-label="Open chats"
        aria-expanded={overlay === "drawer"}
        aria-controls="mobile-drawer"
        onClick={() => open("drawer")}
        className={ROUND}
      >
        <Menu id="mobile-topbar-menu-icon" aria-hidden="true" size={20} />
      </button>
      {onChat ? (
        <div id="mobile-topbar-agent" className="flex flex-col items-center gap-0.5">
          <AgentOrb id="mobile-topbar-orb" look={persona.look} size={26} />
          <span id="mobile-topbar-name" className="max-w-[50vw] truncate text-[12px] font-semibold text-text-primary">
            <bdi id="mobile-topbar-name-bdi">{persona.name}</bdi>
          </span>
        </div>
      ) : (
        <p id="mobile-topbar-title" aria-hidden="true" className="font-display text-[22px] leading-none text-text-primary">
          {title}
        </p>
      )}
      <button id="mobile-topbar-new" type="button" aria-label="New chat" onClick={newChat} className={ROUND}>
        <Plus id="mobile-topbar-new-icon" aria-hidden="true" size={20} />
      </button>
    </header>
  );
}
