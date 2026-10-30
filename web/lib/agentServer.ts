import { readFileSync } from "node:fs";

const SECRET_FILE = "/data/shared/agent-secret";

let cached: string | undefined;

export function agentSecret(read: (path: string) => string = (p) => readFileSync(p, "utf8")): string | undefined {
  if (process.env.AGENT_SHARED_SECRET) return process.env.AGENT_SHARED_SECRET;
  if (cached) return cached;
  try {
    cached = read(process.env.AGENT_SECRET_FILE || SECRET_FILE).trim() || undefined;
  } catch {
    cached = undefined;
  }
  return cached;
}

export function agentUrl(path: string): string {
  return `${process.env.AGENT_URL ?? "http://localhost:8000"}${path}`;
}

export function agentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const secret = agentSecret();
  return secret ? { ...extra, "x-agent-secret": secret } : extra;
}
