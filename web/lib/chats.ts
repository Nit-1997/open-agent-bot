import { readApi } from "@/lib/api";
import type { Page } from "@/lib/pagination";

export type ChatSummary = { id: string; title: string; lastMessageAt: string };
export type StoredMessage = { role: "user" | "assistant"; content: string; status: "complete" | "interrupted"; createdAt: string };
export type HistoryMessage = { id: string; role: "user" | "assistant"; content: string };

export const STOPPED_MARK = "(stopped)";

export const chatsApi = {
  page: async (page: number) => readApi<Page<ChatSummary>>(await fetch(`/api/chats?page=${page}`, { cache: "no-store" })),
  messages: async (id: string) =>
    readApi<{ items: StoredMessage[]; total: number }>(await fetch(`/api/chats/${encodeURIComponent(id)}/messages`, { cache: "no-store" })),
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
