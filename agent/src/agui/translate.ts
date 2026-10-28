import { type BaseEvent, EventType } from "@ag-ui/core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { UiWidget } from "../../../shared/widgets.js";
import { Evidence } from "../grounding/evidence.js";
import { groundUi } from "../grounding/groundUi.js";
import { renderData } from "../render/registry.js";

export type PiEvent = AgentSessionEvent;

type Widget = { kind: string };
type Deps = { newId: () => string; render?: (data: unknown) => Widget | null; evidence?: Evidence };

export function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : JSON.stringify(result ?? "");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function createTranslator(ids: Deps) {
  const render = ids.render ?? renderData;
  const evidence = ids.evidence ?? new Evidence();
  let assistantId: string | undefined;
  let textOpen = false;
  let text = "";
  const renderedKinds = new Set<string>();
  const NOT_AN_ANSWER = new Set(["followups", "grounding_note"]);
  let answered = false;
  const notedClaims = new Set<string>();

  const widgetCall = (id: string, widget: Widget): BaseEvent[] => [
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: id,
      toolCallName: "show_widget",
      ...(assistantId ? { parentMessageId: assistantId } : {}),
    } as BaseEvent,
    { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify({ widget }) } as BaseEvent,
    { type: EventType.TOOL_CALL_END, toolCallId: id } as BaseEvent,
    { type: EventType.TOOL_CALL_RESULT, messageId: ids.newId(), toolCallId: id, content: `rendered ${widget.kind}`, role: "tool" } as BaseEvent,
  ];

  const closeText = (): BaseEvent[] => {
    if (!textOpen || !assistantId) return [];
    textOpen = false;
    const out: BaseEvent[] = [{ type: EventType.TEXT_MESSAGE_END, messageId: assistantId } as BaseEvent];
    const claims = evidence.unverified(text).filter((c) => !notedClaims.has(c));
    for (const c of claims) notedClaims.add(c);
    if (claims.length) out.push(...widgetCall(`${assistantId}-widget`, { kind: "grounding_note", claims } as Widget));
    return out;
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
          text = "";
          out.push({ type: EventType.TEXT_MESSAGE_START, messageId: assistantId, role: "assistant" } as BaseEvent);
        }
        text += a.delta;
        if (a.delta.trim()) answered = true;
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
        const content = resultText(e.result);
        const out: BaseEvent[] = [
          { type: EventType.TOOL_CALL_RESULT, messageId: ids.newId(), toolCallId: e.toolCallId, content, role: "tool" } as BaseEvent,
        ];
        const details = (e.result as { details?: { widget?: Widget; data?: unknown; sourced?: string } } | undefined)?.details;
        if (details?.sourced) evidence.add(details.sourced);
        if (!e.toolName.startsWith("show_") && e.toolName !== "ask_user" && e.toolName !== "suggest_replies") {
          evidence.add(content);
          if (details?.data) evidence.add(JSON.stringify(details.data));
        }
        const fromData = !details?.widget;
        let widget = e.isError ? null : (details?.widget ?? (details?.data ? render(details.data) : null));
        if (widget?.kind === "ui") widget = groundUi(widget as UiWidget, evidence);
        if (e.toolName === "create_artifact" && !e.isError) answered = true;
        if (widget && !(fromData && renderedKinds.has(widget.kind))) {
          if (fromData) renderedKinds.add(widget.kind);
          if (!NOT_AN_ANSWER.has(widget.kind)) answered = true;
          out.push(...widgetCall(`${e.toolCallId}-widget`, widget));
        }
        return out;
      }
      default:
        return [];
    }
  };

  return { translate, finish: closeText, answered: () => answered };
}
