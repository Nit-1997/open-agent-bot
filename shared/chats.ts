export type ChatSummary = { id: string; title: string; lastMessageAt: string };
export type MessageRole = "user" | "assistant";
export type MessageStatus = "complete" | "interrupted";
export type StoredMessage = { role: MessageRole; content: string; status: MessageStatus; createdAt: string };
