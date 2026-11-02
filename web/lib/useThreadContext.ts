"use client";

import { useCopilotKit } from "@copilotkit/react-core/v2";
import { useLayoutEffect } from "react";

export const threadAgentId = (threadId: string) => `chat-${threadId}`;

export function useThreadContext(agentId: string, description: string, value: string | null): void {
  const { copilotkit } = useCopilotKit();
  useLayoutEffect(() => {
    if (value === null) return;
    const id = copilotkit.addContext({ description, value, agentIds: [agentId] });
    return () => copilotkit.removeContext(id);
  }, [copilotkit, agentId, description, value]);
}
