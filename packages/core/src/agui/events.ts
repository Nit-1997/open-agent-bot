import {
  type CustomEvent,
  EventType,
  type RunErrorEvent,
  type RunFinishedEvent,
  type RunStartedEvent,
  type TextMessageContentEvent,
  type TextMessageEndEvent,
  type TextMessageStartEvent,
  type ToolCallArgsEvent,
  type ToolCallEndEvent,
  type ToolCallResultEvent,
  type ToolCallStartEvent,
} from "@ag-ui/core";

export const runStarted = (threadId: string, runId: string): RunStartedEvent => ({ type: EventType.RUN_STARTED, threadId, runId });

export const runFinished = (threadId: string, runId: string): RunFinishedEvent => ({ type: EventType.RUN_FINISHED, threadId, runId });

export const runError = (code: string, message: string): RunErrorEvent => ({ type: EventType.RUN_ERROR, code, message });

export const custom = (name: string, value: unknown): CustomEvent => ({ type: EventType.CUSTOM, name, value });

export const textStart = (messageId: string): TextMessageStartEvent => ({
  type: EventType.TEXT_MESSAGE_START,
  messageId,
  role: "assistant",
});

export const textContent = (messageId: string, delta: string): TextMessageContentEvent => ({
  type: EventType.TEXT_MESSAGE_CONTENT,
  messageId,
  delta,
});

export const textEnd = (messageId: string): TextMessageEndEvent => ({ type: EventType.TEXT_MESSAGE_END, messageId });

export const toolStart = (toolCallId: string, toolCallName: string, parentMessageId?: string): ToolCallStartEvent => ({
  type: EventType.TOOL_CALL_START,
  toolCallId,
  toolCallName,
  ...(parentMessageId ? { parentMessageId } : {}),
});

export const toolArgs = (toolCallId: string, delta: string): ToolCallArgsEvent => ({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta });

export const toolEnd = (toolCallId: string): ToolCallEndEvent => ({ type: EventType.TOOL_CALL_END, toolCallId });

export const toolResult = (messageId: string, toolCallId: string, content: string): ToolCallResultEvent => ({
  type: EventType.TOOL_CALL_RESULT,
  messageId,
  toolCallId,
  content,
  role: "tool",
});
