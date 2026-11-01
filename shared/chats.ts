export type ChatSummary = { id: string; title: string; lastMessageAt: string };
export type MessageRole = "user" | "assistant";
export type MessageStatus = "complete" | "interrupted";
export type MessagePart = { type: "text"; text: string } | { type: "tool"; id: string; name: string; args: string; result?: string };
export type StoredMessage = { role: MessageRole; content: string; status: MessageStatus; createdAt: string; parts?: MessagePart[] };

export const SAVED_TOOLS: ReadonlySet<string> = new Set(["show_widget", "create_artifact", "research"]);

export const TITLE_CHARS = 80;

export const chatTitleFrom = (prompt: string): string => prompt.trim().slice(0, TITLE_CHARS);
