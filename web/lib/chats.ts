import type { ChatSummary, MessagePart, StoredMessage } from "@oab/shared/chats";
import type { Page, PageResponse } from "@oab/shared/pages";
import { readApi } from "@/lib/api";

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type AssistantMessage = { id: string; role: "assistant"; content: string; toolCalls?: ToolCall[] };
export type HistoryMessage =
  | { id: string; role: "user"; content: string }
  | AssistantMessage
  | { id: string; role: "tool"; toolCallId: string; content: string };

export const STOPPED_MARK = "(stopped)";

export const chatsApi = {
  page: async (page: number) => readApi<PageResponse<ChatSummary>>(await fetch(`/api/chats?page=${page}`, { cache: "no-store" })),
  get: async (id: string) => readApi<{ chat: ChatSummary }>(await fetch(`/api/chats/${encodeURIComponent(id)}`, { cache: "no-store" })),
  messages: async (id: string) =>
    readApi<Page<StoredMessage>>(await fetch(`/api/chats/${encodeURIComponent(id)}/messages`, { cache: "no-store" })),
};

function partsOf(m: StoredMessage): MessagePart[] {
  const parts = m.parts ?? [{ type: "text", text: m.content }];
  if (m.status !== "interrupted") return parts;
  const last = parts.at(-1);
  return last?.type === "text"
    ? [...parts.slice(0, -1), { type: "text", text: `${last.text}\n\n${STOPPED_MARK}` }]
    : [...parts, { type: "text", text: STOPPED_MARK }];
}

function assistantMessages(base: string, parts: MessagePart[]): HistoryMessage[] {
  const out: HistoryMessage[] = [];
  let current: AssistantMessage | undefined;
  let results: HistoryMessage[] = [];
  const next = (content: string) => {
    if (current) out.push(current, ...results);
    results = [];
    current = { id: out.length ? `${base}-${out.length}` : base, role: "assistant", content };
    return current;
  };
  for (const p of parts) {
    if (p.type === "text") {
      if (current && !current.toolCalls) current.content = current.content ? `${current.content}\n\n${p.text}` : p.text;
      else next(p.text);
      continue;
    }
    const at = current ?? next("");
    (at.toolCalls ??= []).push({ id: p.id, type: "function", function: { name: p.name, arguments: p.args } });
    results.push({ id: `${base}-result-${p.id}`, role: "tool", toolCallId: p.id, content: p.result ?? "" });
  }
  if (current) out.push(current, ...results);
  return out;
}

export function toHistory(chatId: string, items: StoredMessage[]): HistoryMessage[] {
  return items.flatMap((m, i): HistoryMessage[] => {
    const id = `history-${chatId}-${i}`;
    return m.role === "user" ? [{ id, role: "user", content: m.content }] : assistantMessages(id, partsOf(m));
  });
}

function widgetKind(args: string): string | undefined {
  try {
    const kind = (JSON.parse(args) as { widget?: { kind?: unknown } } | null)?.widget?.kind;
    return typeof kind === "string" ? kind : undefined;
  } catch {
    return undefined;
  }
}

export function cardDates(items: StoredMessage[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of items)
    for (const p of m.parts ?? [])
      if (p.type === "tool" && p.name === "show_widget" && ["cart", "plan"].includes(widgetKind(p.args) ?? "")) out[p.id] = m.createdAt;
  return out;
}

export function formatWhen(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}
