"use client";

import { useLayoutEffect } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { mountedIds } from "@/lib/shell/chatController";
import { useReportUrl } from "@/lib/shell/useReportUrl";
import { useRoute } from "@/lib/shell/useRoute";
import { ChatPane } from "./ChatPane";

export function ChatHost() {
  const { chats, dispatch } = useShell();
  const route = useRoute();
  const visible = route?.section === "chat";
  const chatId = route?.section === "chat" ? route.chatId : undefined;
  const report = route?.section === "chat" ? route.report : null;
  useReportUrl(chatId, report, visible);

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
