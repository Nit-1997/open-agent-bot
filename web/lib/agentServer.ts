import { type AgentAuth, AuthUnavailable, getAgentAuth, SignedOut } from "@/lib/auth";
import { AUTH_ERROR_COPY } from "@/lib/authErrors";
import { agentBaseUrl, appOrigin, ConfigError, serviceSecret } from "@/lib/env";

export type AgentFailure = { status: number; error: string; message: string };

export const MAX_FORWARD_BODY_BYTES = 1024 * 1024;

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

export function authFailureOf(e: unknown): AgentFailure {
  if (e instanceof SignedOut) return { status: 401, error: "signed_out", message: AUTH_ERROR_COPY.signed_out };
  if (e instanceof AuthUnavailable) return { status: 503, error: "auth_unavailable", message: AUTH_ERROR_COPY.auth_unavailable };
  throw e;
}

export function unreachableOf(e: unknown): AgentFailure {
  if (e instanceof ConfigError) throw e;
  return { status: 502, error: "agent_unreachable", message: "The agent isn't reachable." };
}

export const failureResponse = (f: AgentFailure): Response => jsonError(f.status, f.error, f.message);

export const authFailure = (e: unknown): Response => failureResponse(authFailureOf(e));

export const unreachableUnlessMisconfigured = (e: unknown): Response => failureResponse(unreachableOf(e));

async function cappedBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_FORWARD_BODY_BYTES || !req.body) return declared > MAX_FORWARD_BODY_BYTES ? null : "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORWARD_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
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
  const body = isSafeMethod(req.method) ? "" : await cappedBody(req);
  if (body === null) return jsonError(413, "too_large", "That request is too large.");
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
