import type { BaseEvent } from "@ag-ui/core";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { fitWidget, type UiWidget, validateWidget } from "../../../shared/widgets.js";
import { Evidence } from "../grounding/evidence.js";
import { groundUi } from "../grounding/groundUi.js";
import { renderData } from "../render/registry.js";
import { custom, textContent, textEnd, textStart, toolArgs, toolEnd, toolResult, toolStart } from "./events.js";
import { createFollowupSplitter } from "./followups.js";

export type PiEvent = AgentSessionEvent;

type Widget = { kind: string };
type Deps = { newId: () => string; render?: (data: unknown) => Widget | null; evidence?: Evidence };

function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | undefined)?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : JSON.stringify(result ?? "");
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function createTranslator(deps: Deps) {
  const render = deps.render ?? renderData;
  const evidence = deps.evidence ?? new Evidence();
  let assistantId: string | undefined;
  let textOpen = false;
  let text = "";
  const renderedKinds = new Set<string>();
  const NOT_AN_ANSWER = new Set(["followups", "grounding_note"]);
  const scripts = new Set<string>();
  let answered = false;
  const notedClaims = new Set<string>();
  const splitter = createFollowupSplitter();
  let followupsShown = false;

  const widgetCall = (id: string, widget: Widget): BaseEvent[] => [
    toolStart(id, "show_widget", assistantId),
    toolArgs(id, JSON.stringify({ widget })),
    toolEnd(id),
    toolResult(deps.newId(), id, `rendered ${widget.kind}`),
  ];

  const emitText = (chunk: string): BaseEvent[] => {
    if (!chunk) return [];
    const out: BaseEvent[] = [];
    if (!assistantId) assistantId = deps.newId();
    if (!textOpen) {
      textOpen = true;
      text = "";
      out.push(textStart(assistantId));
    }
    text += chunk;
    if (chunk.trim()) answered = true;
    out.push(textContent(assistantId, chunk));
    return out;
  };

  const followupsWidget = (): BaseEvent[] => {
    const replies = splitter.take();
    if (!replies?.length || followupsShown) return [];
    const r = validateWidget(fitWidget({ kind: "followups", replies }));
    if (!r.ok) return [];
    followupsShown = true;
    return widgetCall(`${assistantId ?? deps.newId()}-followups`, r.value);
  };

  const closeText = (): BaseEvent[] => {
    const out = emitText(splitter.flush());
    if (textOpen && assistantId) {
      textOpen = false;
      out.push(textEnd(assistantId));
      const claims = evidence.unverified(text).filter((c) => !notedClaims.has(c));
      for (const c of claims) notedClaims.add(c);
      if (claims.length) out.push(...widgetCall(`${assistantId}-widget`, { kind: "grounding_note", claims } as Widget));
    }
    out.push(...followupsWidget());
    return out;
  };

  type ToolEnd = Extract<PiEvent, { type: "tool_execution_end" }>;
  type Details = { widget?: Widget; data?: unknown; sourced?: string };

  const recordEvidence = (toolName: string, content: string, details: Details | undefined) => {
    if (details?.sourced) evidence.add(details.sourced);
    if (toolName.startsWith("show_") || toolName === "ask_user") return;
    evidence.add(content);
    if (details?.data) evidence.add(JSON.stringify(details.data));
  };

  const widgetFor = (e: ToolEnd, details: Details | undefined): Widget | null => {
    if (e.isError) return null;
    const widget = details?.widget ?? (details?.data ? render(details.data) : null);
    if (!details?.widget && widget && renderedKinds.has(widget.kind)) return null;
    if (!details?.widget && widget) renderedKinds.add(widget.kind);
    return widget?.kind === "ui" ? groundUi(widget as UiWidget, evidence) : widget;
  };

  const toolEnded = (e: ToolEnd): BaseEvent[] => {
    if (e.toolName === "codemode") scripts.delete(e.toolCallId);
    const content = resultText(e.result);
    const details = (e.result as { details?: Details } | undefined)?.details;
    recordEvidence(e.toolName, content, details);
    if ((e.toolName === "create_artifact" || e.toolName === "research") && !e.isError) answered = true;
    const widget = widgetFor(e, details);
    if (!widget) return [toolResult(deps.newId(), e.toolCallId, content)];
    if (!NOT_AN_ANSWER.has(widget.kind) && !scripts.size) answered = true;
    return [toolResult(deps.newId(), e.toolCallId, content), ...widgetCall(`${e.toolCallId}-widget`, widget)];
  };

  const isAssistant = (m: unknown) => (m as { role?: string }).role === "assistant";

  const translate = (e: PiEvent): BaseEvent[] => {
    switch (e.type) {
      case "message_start": {
        if (!isAssistant(e.message)) return [];
        const closed = closeText();
        assistantId = deps.newId();
        return closed;
      }
      case "message_update": {
        const a = e.assistantMessageEvent;
        return a.type === "text_delta" && a.delta ? emitText(splitter.push(a.delta)) : [];
      }
      case "message_end":
        return isAssistant(e.message) ? closeText() : [];
      case "tool_execution_start":
        if (e.toolName === "codemode") scripts.add(e.toolCallId);
        return [
          ...closeText(),
          toolStart(e.toolCallId, e.toolName, assistantId),
          toolArgs(e.toolCallId, JSON.stringify(e.args ?? {})),
          toolEnd(e.toolCallId),
        ];
      case "tool_execution_update": {
        const step = (e.partialResult as { details?: { workflowStep?: unknown } } | undefined)?.details?.workflowStep;
        return step ? [custom("workflow_step", step)] : [];
      }
      case "tool_execution_end":
        return toolEnded(e);
      default:
        return [];
    }
  };

  return { translate, finish: closeText, answered: () => answered };
}
