"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function Providers({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      {children}
    </CopilotKit>
  );
}
