"use client";

import Link from "next/link";
import { ListState } from "@/components/ui/ListState";
import { useChatIndex, chatIndex } from "@/lib/chatIndex";
import { DATE_GROUP_LABEL, groupItems } from "@/lib/dateGroups";
import { useRoute } from "@/lib/shell/useRoute";
import type { ChatSummary } from "@shared/chats";
import { ChatListGroup } from "./ChatListGroup";

export const DRAWER_ROWS = 5;
const moreButton =
  "rounded-full border border-border px-3 py-1 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary disabled:opacity-40";

export function GroupedChats(props: {
  id: string;
  rowPrefix: string;
  chats: ChatSummary[];
  activeChatId: string | null;
  onNavigate?: () => void;
}) {
  return (
    <div id={props.id} className="flex flex-col gap-3">
      {groupItems(props.chats, (c) => c.lastMessageAt).map((g) => (
        <ChatListGroup
          key={g.group}
          id={`${props.id}-${g.group}`}
          rowPrefix={props.rowPrefix}
          label={DATE_GROUP_LABEL[g.group]}
          chats={g.items}
          activeChatId={props.activeChatId}
          onNavigate={props.onNavigate}
        />
      ))}
    </div>
  );
}

export function useActiveChatId(): string | null {
  const route = useRoute();
  return route?.section === "chat" ? route.chatId : null;
}

export function ChatList(props: { id: string; variant: "sidebar" | "drawer"; onNavigate?: () => void }) {
  const { id, variant } = props;
  const index = useChatIndex();
  const activeChatId = useActiveChatId();
  const retry = () => void chatIndex.load();

  if (index.status === "error" && !index.items.length)
    return <ListState id={`${id}-state`} state={{ kind: "error", message: `Couldn't load chats: ${index.error}`, onRetry: retry }} />;
  if ((index.status === "idle" || index.status === "loading") && !index.items.length)
    return <ListState id={`${id}-state`} state={{ kind: "loading", rows: 3 }} />;
  if (!index.items.length)
    return <ListState id={`${id}-state`} state={{ kind: "empty", children: "No chats yet. Start one with New chat." }} />;

  if (variant === "drawer") {
    return (
      <div id={id} className="flex flex-col">
        <ChatListGroup
          id={`${id}-recent`}
          rowPrefix={id}
          label="Recent"
          chats={index.items.slice(0, DRAWER_ROWS)}
          activeChatId={activeChatId}
          large
          onNavigate={props.onNavigate}
        />
        {index.total > DRAWER_ROWS && (
          <Link id={`${id}-all`} href="/chats" onClick={props.onNavigate} className="px-3 py-2.5 text-[13px] text-mist-600 hover:underline">
            {`Show all ${index.total} chats`}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div id={id} className="flex flex-col gap-2">
      <GroupedChats id={`${id}-groups`} rowPrefix={id} chats={index.items} activeChatId={activeChatId} onNavigate={props.onNavigate} />
      <div id={`${id}-footer`} className="flex items-center justify-between gap-2 px-2.5 pt-1">
        <p id={`${id}-count`} className="text-[12px] text-text-muted">
          {`Showing ${index.items.length} of ${index.total}`}
        </p>
        {index.items.length < index.total && (
          <button id={`${id}-more`} type="button" disabled={index.loadingMore} onClick={() => void chatIndex.more()} className={moreButton}>
            {index.loadingMore ? "Loading…" : "Show more"}
          </button>
        )}
      </div>
      {index.moreError && (
        <ListState
          id={`${id}-more-error`}
          state={{ kind: "error", message: `Couldn't load chats: ${index.moreError}`, onRetry: () => void chatIndex.more() }}
        />
      )}
      {index.status === "ready" && index.error && (
        <ListState id={`${id}-refresh-error`} state={{ kind: "error", message: `Couldn't load chats: ${index.error}`, onRetry: retry }} />
      )}
    </div>
  );
}
