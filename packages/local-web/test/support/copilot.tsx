import type { ReactNode } from "react";
import { copilotMock as uiCopilotMock } from "../../../ui/test/support/copilot.ts";

export const runtimeUrls: string[] = [];

export const copilotMock = () => ({
  ...uiCopilotMock(),
  CopilotKit: ({ runtimeUrl, children }: { runtimeUrl: string; children: ReactNode }) => {
    runtimeUrls.push(runtimeUrl);
    return children;
  },
});
