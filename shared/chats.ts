export type ChatSummary = { id: string; title: string; lastMessageAt: string };
export type MessageRole = "user" | "assistant";
export type MessageStatus = "complete" | "interrupted";
export type StoredMessage = { role: MessageRole; content: string; status: MessageStatus; createdAt: string };

export const TITLE_CHARS = 80;

export const chatTitleFrom = (prompt: string): string => prompt.trim().slice(0, TITLE_CHARS);
