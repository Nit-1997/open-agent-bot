"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { api } from "@oab/ui/platform/api";
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
    <CopilotKit runtimeUrl={api().url("/copilotkit")} useSingleEndpoint={false}>
      {children}
    </CopilotKit>
  );
}
