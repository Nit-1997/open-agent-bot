import { type BaseEvent, EventType } from "@ag-ui/core";
import { type MessagePart, SAVED_TOOLS } from "../../../shared/chats.js";

export const PART_RESULT_CHARS = 2000;
export const PARTS_CHARS = 500_000;

type Seen = { type: "text"; id: string; text: string } | { type: "tool"; id: string; name: string; args: string; result?: string };

function savedArgs(name: string, raw: string): string {
  if (name === "show_widget") return raw;
  try {
    const title = (JSON.parse(raw) as { title?: unknown }).title;
    return JSON.stringify(typeof title === "string" ? { title } : {});
  } catch {
    return "{}";
  }
}

export class Transcript {
  private readonly texts = new Map<string, string>();
  private readonly seen: Seen[] = [];
  private readonly tools = new Map<string, Extract<Seen, { type: "tool" }>>();

  see(e: BaseEvent): void {
    if (e.type === EventType.TEXT_MESSAGE_CONTENT) {
      const { messageId, delta } = e as BaseEvent & { messageId: string; delta: string };
      this.texts.set(messageId, (this.texts.get(messageId) ?? "") + delta);
      const last = this.seen.at(-1);
      if (last?.type === "text" && last.id === messageId) last.text += delta;
      else this.seen.push({ type: "text", id: messageId, text: delta });
    } else if (e.type === EventType.TOOL_CALL_START) {
      const { toolCallId, toolCallName } = e as BaseEvent & { toolCallId: string; toolCallName: string };
      if (!SAVED_TOOLS.has(toolCallName)) return;
      const tool = { type: "tool" as const, id: toolCallId, name: toolCallName, args: "" };
      this.tools.set(toolCallId, tool);
      this.seen.push(tool);
    } else if (e.type === EventType.TOOL_CALL_ARGS) {
      const { toolCallId, delta } = e as BaseEvent & { toolCallId: string; delta: string };
      const tool = this.tools.get(toolCallId);
      if (tool) tool.args += delta;
    } else if (e.type === EventType.TOOL_CALL_RESULT) {
      const { toolCallId, content } = e as BaseEvent & { toolCallId: string; content: string };
      const tool = this.tools.get(toolCallId);
      if (tool) tool.result = content.slice(0, PART_RESULT_CHARS);
    }
  }

  text(): string {
    return [...this.texts.values()]
      .map((t) => t.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  parts(): MessagePart[] | undefined {
    if (!this.tools.size) return undefined;
    const parts = this.seen.flatMap((p): MessagePart[] => {
      if (p.type === "text") return p.text.trim() ? [{ type: "text", text: p.text.trim() }] : [];
      const tool: MessagePart = { type: "tool", id: p.id, name: p.name, args: savedArgs(p.name, p.args) };
      return [p.result === undefined ? tool : { ...tool, result: p.result }];
    });
    const fits = (list: MessagePart[]) => JSON.stringify(list).length <= PARTS_CHARS;
    if (fits(parts)) return parts;
    const reports = parts.filter((p) => p.type === "text" || p.name !== "show_widget");
    return fits(reports) ? reports : undefined;
  }
}
