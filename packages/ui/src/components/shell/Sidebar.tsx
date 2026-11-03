"use client";

import { Link, usePlatform } from "@oab/ui/platform";
import { ChatList } from "@/components/chat/ChatList";
import { useChatIndex } from "@/lib/chatIndex";
import { AgentCard } from "./AgentCard";
import { NewChatButton } from "./NewChatButton";
import { SidebarSearch } from "./SidebarSearch";

export function SidebarContent(props: { onNavigate?: () => void }) {
  const index = useChatIndex();
  const UsageMeter = usePlatform().slots.usageMeter;
  return (
    <>
      <div id="sidebar-top" className="flex items-center gap-2">
        <div id="sidebar-search-wrap" className="min-w-0 flex-1">
          <SidebarSearch id="sidebar-search" placeholder="Search" />
        </div>
        <NewChatButton id="sidebar-new-chat" variant="round" onDone={props.onNavigate} />
      </div>
      <div id="sidebar-scroll" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <ChatList id="chat-list-sidebar" variant="sidebar" onNavigate={props.onNavigate} />
        <Link
          id="sidebar-all-chats"
          href="/chats"
          onClick={props.onNavigate}
          className="mt-2 block px-2.5 py-1.5 text-[12px] text-text-muted hover:text-text-primary"
        >
          {`All chats · ${index.total}`}
        </Link>
      </div>
      {UsageMeter && (
        <div id="sidebar-usage">
          <UsageMeter id="sidebar-usage-meter" variant="sidebar" />
        </div>
      )}
      <AgentCard id="agent-card" />
    </>
  );
}

export function Sidebar(props: { open: boolean }) {
  return (
    <aside
      id="sidebar"
      aria-label="Chats"
      hidden={!props.open}
      className="flex w-[300px] shrink-0 flex-col gap-[18px] border-r border-surface-accent bg-sidebar px-3.5 py-[18px]"
    >
      <SidebarContent />
    </aside>
  );
}
