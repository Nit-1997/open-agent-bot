"use client";

import {
  CopilotChat,
  useAgent,
  useAgentContext,
  useCopilotKit,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ToolActivity } from "@/components/ToolActivity";
import { classifyRunError, type RunErrorKind } from "@/lib/errors";
import { getUserContext, type UserContext } from "@/lib/userContext";

export const AGENT_ID = "openagent";

function newThreadId() {
  return crypto.randomUUID();
}

export function Chat() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [error, setError] = useState<{
    kind: RunErrorKind;
    message?: string;
  } | null>(null);

  useEffect(() => {
    setThreadId(newThreadId());
    setUserContext(getUserContext());
  }, []);
  const { agent } = useAgent({ agentId: AGENT_ID });
  const { copilotkit } = useCopilotKit();

  useAgentContext({
    description: "user_context",
    value: userContext ? JSON.stringify(userContext) : "",
  });

  useDefaultRenderTool(
    {
      render: ({ name, toolCallId, status, parameters }) => (
        <ToolActivity
          toolCallId={toolCallId}
          name={name}
          status={status}
          parameters={parameters}
        />
      ),
    },
    [],
  );

  const startNewChat = useCallback(() => {
    setError(null);
    setThreadId(newThreadId());
    setUserContext(getUserContext());
  }, []);

  const retry = useCallback(() => {
    setError(null);
    void copilotkit.runAgent({ agent }).catch(() => {});
  }, [agent, copilotkit]);

  return (
    <div
      id="chat-shell"
      className="mx-auto flex h-dvh w-full max-w-[760px] flex-col"
    >
      <header
        id="chat-header"
        className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800"
      >
        <h1 id="chat-title" className="text-base font-semibold">
          Open Agent
        </h1>
        <button
          id="chat-new-button"
          type="button"
          onClick={startNewChat}
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          New chat
        </button>
      </header>
      {error && (
        <ErrorBanner
          kind={error.kind}
          message={error.message}
          onNewChat={startNewChat}
          onRetry={retry}
          onDismiss={() => setError(null)}
        />
      )}
      <main id="chat-main" className="min-h-0 flex-1">
        {threadId && (
          <CopilotChat
            key={threadId}
            agentId={AGENT_ID}
            threadId={threadId}
            className="h-full"
            labels={{
              chatInputPlaceholder: "Ask me to research, compare, or plan…",
            }}
            onError={(event) => {
              if ("error" in event)
                setError({
                  kind: classifyRunError(event),
                  message: event.error?.message,
                });
            }}
          />
        )}
      </main>
    </div>
  );
}
