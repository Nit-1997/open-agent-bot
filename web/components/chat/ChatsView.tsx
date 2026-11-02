"use client";

import type { ChatSummary } from "@shared/chats";
import { useCallback } from "react";
import { ListState } from "@/components/ui/ListState";
import { Pager } from "@/components/ui/Pager";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SectionPage } from "@/components/ui/SectionPage";
import { chatsApi } from "@/lib/chats";
import { usePageNav } from "@/lib/shell/usePageNav";
import { usePagedList } from "@/lib/usePagedList";
import { GroupedChats, useActiveChatId } from "./ChatList";

export function ChatsView({ page }: { page: number }) {
  const id = "chats-view";
  const nav = usePageNav(useCallback((p: number) => ({ section: "chats" as const, page: p }), []));
  const fetchPage = useCallback((p: number) => chatsApi.page(p), []);
  const list = usePagedList<ChatSummary>({ key: "chats", page, fetchPage, onPastEnd: nav.replace });
  const activeChatId = useActiveChatId();
  const data = list.data;
  return (
    <SectionPage id={id}>
      <SectionHeader
        id={`${id}-header`}
        title="All chats"
        count={data ? `${data.total} ${data.total === 1 ? "chat" : "chats"}` : undefined}
      />
      {list.status === "error" && (
        <ListState id={`${id}-error`} state={{ kind: "error", message: `Couldn't load chats: ${list.error}`, onRetry: list.retry }} />
      )}
      {list.status === "loading" && !data && <ListState id={`${id}-loading`} state={{ kind: "loading", rows: 6 }} />}
      {data && data.total === 0 && (
        <ListState id={`${id}-empty`} state={{ kind: "empty", children: "No chats yet. Start one with New chat." }} />
      )}
      {data && data.items.length > 0 && (
        <>
          <GroupedChats id={`${id}-list`} rowPrefix={id} chats={data.items} activeChatId={activeChatId} />
          <Pager
            id={`${id}-pager`}
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            busy={list.status === "loading"}
            onPage={nav.push}
          />
        </>
      )}
    </SectionPage>
  );
}
