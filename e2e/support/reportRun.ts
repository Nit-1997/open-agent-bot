import type { Page } from "@playwright/test";
import { LIVE_REPORT } from "./seed";

export const RUN_PATH = "**/api/copilotkit/agent/openagent/run";

type RunBody = { threadId?: string; runId?: string; context?: Array<{ description: string; value: string }> };

export function reportRunEvents(threadId: string, runId: string): object[] {
  const message = `msg-${runId}`;
  const text = `text-${runId}`;
  const { id, title, toolCallId } = LIVE_REPORT;
  return [
    { type: "RUN_STARTED", threadId, runId },
    { type: "TOOL_CALL_START", toolCallId, toolCallName: "create_artifact", parentMessageId: message },
    { type: "TOOL_CALL_ARGS", toolCallId, delta: JSON.stringify({ title }) },
    { type: "TOOL_CALL_END", toolCallId },
    { type: "TOOL_CALL_RESULT", messageId: `result-${runId}`, toolCallId, content: `artifact ${id} created: ${title}`, role: "tool" },
    { type: "TEXT_MESSAGE_START", messageId: text, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: text, delta: "Here's your packing list, open on the right." },
    { type: "TEXT_MESSAGE_END", messageId: text },
    { type: "RUN_FINISHED", threadId, runId },
  ];
}

export async function mockReportRun(page: Page): Promise<{ body: () => RunBody | null }> {
  let seen: RunBody | null = null;
  await page.route(
    RUN_PATH,
    async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as RunBody;
      seen = body;
      const events = reportRunEvents(body.threadId ?? "", body.runId ?? "run-e2e");
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
      });
    },
    { times: 1 },
  );
  return { body: () => seen };
}
