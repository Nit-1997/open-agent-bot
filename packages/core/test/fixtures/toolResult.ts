import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export function textOf(result: Pick<AgentToolResult<unknown>, "content">, index = 0): string {
  const part = result.content[index];
  if (part?.type !== "text") throw new Error(`expected text content at ${index}, got ${part?.type ?? "nothing"}`);
  return part.text;
}
