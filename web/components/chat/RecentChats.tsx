"use client";

import type { ChatSummary } from "@shared/chats";
import type { PageResponse } from "@shared/pages";
import { useEffect, useState } from "react";
import { ghost, solid } from "@/components/profile/models/styles";
import { DetailList } from "@/components/ui/DetailList";
import { Pager } from "@/components/ui/Pager";
import { chatsApi, formatWhen, type HistoryMessage, toHistory } from "@/lib/chats";
import { errorMessage } from "@/lib/errors";

type Loaded = { key: string; data?: PageResponse<ChatSummary>; error?: string };

export function RecentChats(props: { currentThreadId: string; onOpen: (chatId: string, history: HistoryMessage[]) => void }) {
  const id = "recent-chats";
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [shown, setShown] = useState<PageResponse<ChatSummary> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ chatId: string; message: string } | null>(null);
  const key = `${page}:${attempt}`;
  const loading = loaded?.key !== key;

  useEffect(() => {
    let alive = true;
    chatsApi
      .page(page)
      .then((data) => {
        if (!alive) return;
        if (data.items.length === 0 && page > 1) {
          setPage(Math.max(1, Math.ceil(data.total / data.pageSize)));
          return;
        }
        setLoaded({ key, data });
        setShown(data);
      })
      .catch((e: unknown) => alive && setLoaded({ key, error: errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, [page, key]);

  const open = async (chat: ChatSummary) => {
    setOpening(chat.id);
    setRowError(null);
    try {
      const { items } = await chatsApi.messages(chat.id);
      props.onOpen(chat.id, toHistory(chat.id, items));
    } catch (e) {
      setRowError({ chatId: chat.id, message: errorMessage(e) });
    } finally {
      setOpening(null);
    }
  };

  const error = !loading ? loaded?.error : undefined;

  return (
    <div id={id} className="space-y-2">
      {error && (
        <div
          id={`${id}-error`}
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg"
        >
          <span id={`${id}-error-text`}>{`Couldn't load chats: ${error}`}</span>
          <button id={`${id}-retry`} type="button" onClick={() => setAttempt((a) => a + 1)} className={ghost}>
            Retry
          </button>
        </div>
      )}
      {!shown && loading && (
        <p id={`${id}-loading`} className="text-xs text-text-muted">
          Loading chats…
        </p>
      )}
      {shown && shown.total === 0 && (
        <p id={`${id}-empty`} className="text-xs text-text-muted">
          No chats yet.
        </p>
      )}
      {shown && shown.total > 0 && (
        <>
          <ul id={`${id}-list`} className="space-y-1.5">
            {shown.items.map((chat) => {
              const rowId = `${id}-row-${chat.id}`;
              const isOpen = expanded === chat.id;
              const current = chat.id === props.currentThreadId;
              return (
                <li id={rowId} key={chat.id} className="rounded-xl border border-border bg-paper px-3 py-2">
                  <div id={`${rowId}-head`} className="flex items-center gap-2">
                    <p id={`${rowId}-title`} className="min-w-0 flex-1 truncate text-sm text-text-primary">
                      {chat.title.trim() || "Untitled chat"}
                      {current && (
                        <span id={`${rowId}-current`} className="ml-1.5 text-[11px] text-text-muted">
                          (current)
                        </span>
                      )}
                    </p>
                    <button
                      id={`${id}-view-${chat.id}`}
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : chat.id)}
                      className={ghost}
                    >
                      View
                    </button>
                    <button
                      id={`${id}-open-${chat.id}`}
                      type="button"
                      disabled={opening !== null || current}
                      onClick={() => void open(chat)}
                      className={solid}
                    >
                      {opening === chat.id ? "Opening…" : "Open"}
                    </button>
                  </div>
                  {isOpen && (
                    <DetailList
                      id={`${id}-details-${chat.id}`}
                      items={[
                        ["title", "Title", chat.title.trim() || "Untitled chat"],
                        ["date", "Last message", formatWhen(chat.lastMessageAt)],
                      ]}
                    />
                  )}
                  {rowError?.chatId === chat.id && (
                    <p id={`${id}-row-error-${chat.id}`} role="alert" className="mt-1.5 text-xs text-danger-fg">
                      {`Couldn't open this chat: ${rowError.message}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager id={`${id}-pager`} page={shown.page} pageSize={shown.pageSize} total={shown.total} busy={loading} onPage={setPage} />
        </>
      )}
    </div>
  );
}
