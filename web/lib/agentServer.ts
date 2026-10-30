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

export async function forwardToAgent(req: Request, path: string): Promise<Response> {
  try {
    const upstream = await fetch(agentUrl(path), {
      method: req.method,
      headers: agentHeaders({ "content-type": "application/json" }),
      body: req.method === "GET" || req.method === "DELETE" ? undefined : await req.text(),
      cache: "no-store",
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "The agent isn't reachable." }, { status: 502 });
  }
}
