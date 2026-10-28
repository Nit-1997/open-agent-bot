export function agentUrl(path: string): string {
  return `${process.env.AGENT_URL ?? "http://localhost:8000"}${path}`;
}

export function agentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return process.env.AGENT_SHARED_SECRET ? { ...extra, "x-agent-secret": process.env.AGENT_SHARED_SECRET } : extra;
}
