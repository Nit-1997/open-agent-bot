export type ToolResult = {
  content: { type: "text"; text: string }[];
  details: Record<string, unknown>;
  isError?: boolean;
};

export function ok(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details };
}

export function fail(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details, isError: true };
}
