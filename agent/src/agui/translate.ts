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

export function createTranslator(ids: Deps) {
  const render = ids.render ?? renderData;
  const evidence = ids.evidence ?? new Evidence();
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
    toolResult(ids.newId(), id, `rendered ${widget.kind}`),
  ];

  const emitText = (chunk: string): BaseEvent[] => {
    if (!chunk) return [];
    const out: BaseEvent[] = [];
    if (!assistantId) assistantId = ids.newId();
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
    return widgetCall(`${assistantId ?? ids.newId()}-followups`, r.value);
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
        return emitText(splitter.push(a.delta));
      }
      case "message_end":
        return (e.message as { role?: string }).role === "assistant" ? closeText() : [];
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
      case "tool_execution_end": {
        if (e.toolName === "codemode") scripts.delete(e.toolCallId);
        const content = resultText(e.result);
        const out: BaseEvent[] = [toolResult(ids.newId(), e.toolCallId, content)];
        const details = (e.result as { details?: { widget?: Widget; data?: unknown; sourced?: string } } | undefined)?.details;
        if (details?.sourced) evidence.add(details.sourced);
        if (!e.toolName.startsWith("show_") && e.toolName !== "ask_user") {
          evidence.add(content);
          if (details?.data) evidence.add(JSON.stringify(details.data));
        }
        const fromData = !details?.widget;
        let widget = e.isError ? null : (details?.widget ?? (details?.data ? render(details.data) : null));
        if (widget?.kind === "ui") widget = groundUi(widget as UiWidget, evidence);
        if ((e.toolName === "create_artifact" || e.toolName === "research") && !e.isError) answered = true;
        if (widget && !(fromData && renderedKinds.has(widget.kind))) {
          if (fromData) renderedKinds.add(widget.kind);
          if (!NOT_AN_ANSWER.has(widget.kind) && !scripts.size) answered = true;
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
