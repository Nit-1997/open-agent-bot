"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { api } from "./api.ts";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function ChatRuntime({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return (
    <CopilotKit runtimeUrl={api().url("/copilotkit")} useSingleEndpoint={false} showDevConsole={false}>
      {children}
    </CopilotKit>
  );
}
