"use client";

import { parseRoute } from "@shared/routes";
import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { mountedIds } from "@/lib/shell/chatController";
import { ChatPane } from "./ChatPane";

export function ChatHost() {
  const pathname = usePathname();
  const { chats, dispatch } = useShell();
  const route = parseRoute(pathname);
  const visible = route?.section === "chat";
  const chatId = route?.section === "chat" ? route.chatId : undefined;

  useLayoutEffect(() => {
    if (chatId === undefined) return;
    if (chatId) dispatch({ type: "open", id: chatId });
    else dispatch({ type: "showDraft", freshId: crypto.randomUUID() });
  }, [chatId, dispatch]);

  return (
    <div id="chat-host" hidden={!visible} inert={!visible} className="flex min-h-0 flex-1 flex-col">
      {mountedIds(chats).map((threadId) => (
        <ChatPane key={threadId} threadId={threadId} active={threadId === chats.activeId} visible={visible} />
      ))}
    </div>
  );
}
