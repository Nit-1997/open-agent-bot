import type { SearchHit } from "@shared/lists";
import { FileText, MessageSquare } from "lucide-react";
import Link from "next/link";
import { UNTITLED } from "@/components/chat/ChatHeader";
import { fromChat } from "@/components/reports/ReportRow";
import { shortDate } from "@/lib/dates";
import { Highlight } from "./Highlight";

export const hitKey = (h: SearchHit) => (h.kind === "chat" ? `chat-${h.chatId}` : `report-${h.id}`);

export function SearchHitRow({ id, hit, query }: { id: string; hit: SearchHit; query: string }) {
  const chat = hit.kind === "chat";
  const Icon = chat ? MessageSquare : FileText;
  const title = hit.title.trim() || (chat ? UNTITLED : "Untitled report");
  return (
    <li id={id}>
      <Link
        id={`${id}-link`}
        href={chat ? `/chats/${hit.chatId}` : `/reports/${hit.id}`}
        className="flex gap-3 rounded-2xl border border-transparent px-3 py-3 transition hover:border-surface-accent hover:bg-surface"
      >
        <Icon id={`${id}-icon`} aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-text-faint" />
        <span id={`${id}-body`} className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={`${id}-title`} className="truncate text-[15px] font-medium text-text-primary" title={title}>
            <bdi id={`${id}-title-bdi`}>
              <Highlight id={`${id}-title-hl`} text={title} query={query} />
            </bdi>
          </span>
          <span id={`${id}-meta`} className="truncate text-[12px] text-text-muted">
            {chat ? `Chat · ${shortDate(hit.at)}` : `Report · ${shortDate(hit.at)} · from ${fromChat(hit)}`}
          </span>
          {chat && hit.snippet && (
            <span id={`${id}-snippet`} className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-secondary">
              {hit.snippet.truncatedStart && "…"}
              <Highlight id={`${id}-snippet-hl`} text={hit.snippet.text} query={query} />
              {hit.snippet.truncatedEnd && "…"}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
