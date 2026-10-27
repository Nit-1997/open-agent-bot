import { type BaseEvent, EventType } from "@ag-ui/core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type PiEvent = AgentSessionEvent;

type Ids = { newId: () => string };

export function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : JSON.stringify(result ?? "");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function createTranslator(ids: Ids) {
  let assistantId: string | undefined;
  let textOpen = false;

  const closeText = (): BaseEvent[] => {
    if (!textOpen || !assistantId) return [];
    textOpen = false;
    return [{ type: EventType.TEXT_MESSAGE_END, messageId: assistantId } as BaseEvent];
  };

  const translate = (e: PiEvent): BaseEvent[] => {
    switch (e.type) {
      case "message_start":
        if ((e.message as { role?: string }).role === "assistant") {
          const closed = closeText();
          assistantId = ids.newId();
          return closed;
        }
        return [];
      case "message_update": {
        const a = e.assistantMessageEvent;
        if (a.type !== "text_delta" || !a.delta) return [];
        const out: BaseEvent[] = [];
        if (!assistantId) assistantId = ids.newId();
        if (!textOpen) {
          textOpen = true;
          out.push({ type: EventType.TEXT_MESSAGE_START, messageId: assistantId, role: "assistant" } as BaseEvent);
        }
        out.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: assistantId, delta: a.delta } as BaseEvent);
        return out;
      }
      case "message_end":
        return (e.message as { role?: string }).role === "assistant" ? closeText() : [];
      case "tool_execution_start":
        return [
          ...closeText(),
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: e.toolCallId,
            toolCallName: e.toolName,
            ...(assistantId ? { parentMessageId: assistantId } : {}),
          } as BaseEvent,
          { type: EventType.TOOL_CALL_ARGS, toolCallId: e.toolCallId, delta: JSON.stringify(e.args ?? {}) } as BaseEvent,
          { type: EventType.TOOL_CALL_END, toolCallId: e.toolCallId } as BaseEvent,
        ];
      case "tool_execution_end": {
        const out: BaseEvent[] = [
          {
            type: EventType.TOOL_CALL_RESULT,
            messageId: ids.newId(),
            toolCallId: e.toolCallId,
            content: resultText(e.result),
            role: "tool",
          } as BaseEvent,
        ];
        const widget = (e.result as { details?: { widget?: { kind?: string } } } | undefined)?.details?.widget;
        if (widget && !e.isError && e.toolName !== "show_widget") {
          const id = `${e.toolCallId}-widget`;
          out.push(
            {
              type: EventType.TOOL_CALL_START,
              toolCallId: id,
              toolCallName: "show_widget",
              ...(assistantId ? { parentMessageId: assistantId } : {}),
            } as BaseEvent,
            { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify({ widget }) } as BaseEvent,
            { type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent,
            {
              type: EventType.TOOL_CALL_RESULT,
              messageId: ids.newId(),
              toolCallId: id,
              content: `rendered ${widget.kind}`,
              role: "tool",
            } as BaseEvent,
          );
        }
        return out;
      }
      default:
        return [];
    }
  };

  return { translate, finish: closeText };
}
