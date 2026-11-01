import { type AgentAuth, AuthUnavailable, getAgentAuth, SignedOut } from "@/lib/auth";
import { agentBaseUrl, appOrigin, ConfigError, serviceSecret } from "@/lib/env";

const AGENT_TIMEOUT_MS = 30_000;
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export type AgentRequest = { method?: string; headers?: Record<string, string>; body?: string };

export function agentUrl(path: string): string {
  return `${agentBaseUrl()}${path}`;
}

export function agentHeaders(auth: AgentAuth | null): Record<string, string> {
  const headers: Record<string, string> = { "x-agent-secret": serviceSecret() };
  if (auth) headers.authorization = `Bearer ${auth.accessToken}`;
  return headers;
}

export function agentFetch(path: string, auth: AgentAuth | null, init: AgentRequest = {}): Promise<Response> {
  return fetch(agentUrl(path), {
    method: init.method ?? "GET",
    headers: { ...init.headers, ...agentHeaders(auth) },
    body: init.body,
    cache: "no-store",
    signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });
}

export function jsonError(status: number, error: string, message?: string): Response {
  return Response.json(message ? { error, message } : { error }, { status, headers: { "cache-control": "private, no-store" } });
}

export function isSameOrigin(req: Request): boolean {
  return req.headers.get("origin") === appOrigin();
}

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}

export function authFailure(e: unknown): Response {
  if (e instanceof SignedOut) return jsonError(401, "signed_out");
  if (e instanceof AuthUnavailable) return jsonError(503, "auth_unavailable", "Can't reach the account service. Try again in a minute.");
  throw e;
}

const agentUnreachable = () => jsonError(502, "agent_unreachable", "The agent isn't reachable.");

export function unreachableUnlessMisconfigured(e: unknown): Response {
  if (e instanceof ConfigError) throw e;
  return agentUnreachable();
}

export async function forwardToAgent(req: Request, path: string): Promise<Response> {
  if (!isSafeMethod(req.method) && !isSameOrigin(req)) return jsonError(403, "bad_origin");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    return authFailure(e);
  }
  const contentType = req.headers.get("content-type");
  const body = isSafeMethod(req.method) ? "" : await req.text();
  let upstream: Response;
  try {
    upstream = await agentFetch(path, auth, {
      method: req.method,
      headers: contentType ? { "content-type": contentType } : {},
      body: body || undefined,
    });
  } catch (e) {
    return unreachableUnlessMisconfigured(e);
  }
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "private, no-store",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(upstream.body, { status: upstream.status, headers });
}
