import type { ChatSummary, StoredMessage } from "@shared/chats";
import type { Page, PageResponse } from "@shared/pages";
import { readApi } from "@/lib/api";

export type HistoryMessage = { id: string; role: "user" | "assistant"; content: string };

export const STOPPED_MARK = "(stopped)";

export const chatsApi = {
  page: async (page: number) => readApi<PageResponse<ChatSummary>>(await fetch(`/api/chats?page=${page}`, { cache: "no-store" })),
  get: async (id: string) => readApi<{ chat: ChatSummary }>(await fetch(`/api/chats/${encodeURIComponent(id)}`, { cache: "no-store" })),
  messages: async (id: string) =>
    readApi<Page<StoredMessage>>(await fetch(`/api/chats/${encodeURIComponent(id)}/messages`, { cache: "no-store" })),
};

export function toHistory(chatId: string, items: StoredMessage[]): HistoryMessage[] {
  return items.map((m, i) => ({
    id: `history-${chatId}-${i}`,
    role: m.role,
    content: m.status === "interrupted" ? `${m.content}\n\n${STOPPED_MARK}` : m.content,
  }));
}

export function formatWhen(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
