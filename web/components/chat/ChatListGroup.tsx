"use client";

import type { ChatSummary } from "@oab/shared/chats";
import { Link } from "@oab/ui/platform";
import { AgentOrb } from "@/components/agent/AgentOrb";
import { useShell } from "@/components/shell/ShellProvider";
import { UNTITLED } from "./ChatHeader";

export function ChatListGroup(props: {
  id: string;
  rowPrefix: string;
  label: string;
  chats: ChatSummary[];
  activeChatId?: string | null;
  large?: boolean;
  onNavigate?: () => void;
}) {
  const { id, large } = props;
  const { running, persona } = useShell();
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex flex-col">
      <h2 id={`${id}-heading`} className="eyebrow mb-1.5 ml-2.5 mt-1">
        {props.label}
      </h2>
      <ul id={`${id}-list`} aria-labelledby={`${id}-heading`} className="flex flex-col gap-0.5">
        {props.chats.map((chat) => {
          const rowId = `${props.rowPrefix}-row-${chat.id}`;
          const title = chat.title.trim() || UNTITLED;
          const active = chat.id === props.activeChatId;
          const working = running.has(chat.id);
          return (
            <li id={`${rowId}-item`} key={chat.id}>
              <Link
                id={rowId}
                href={`/chats/${chat.id}`}
                title={title}
                aria-current={active ? "page" : undefined}
                onClick={props.onNavigate}
                className={`flex items-center gap-2 rounded-xl px-3 ${large ? "py-3 text-[15px]" : "py-2.5 text-[14px]"} transition ${active ? "border border-border bg-paper text-text-primary dark:border-transparent" : "border border-transparent text-text-secondary hover:bg-surface hover:text-text-primary"}`}
              >
                <span id={`${rowId}-title`} className="min-w-0 flex-1 truncate">
                  <bdi id={`${rowId}-bdi`}>{title}</bdi>
                </span>
                {working && (
                  <>
                    <AgentOrb id={`${rowId}-orb`} look={persona.look} size={22} breathing className="!h-3 !w-3" />
                    <span id={`${rowId}-working`} className="sr-only">
                      working
                    </span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
