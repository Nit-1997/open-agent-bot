import { isAllowedOrigin } from "@oab/bff";
import { type AgentAuth, AuthUnavailable, SignedOut } from "@/lib/auth";
import { AUTH_ERROR_COPY } from "@oab/ui/lib/authErrors.ts";
import { agentBaseUrl, appOrigin, ConfigError, serviceSecret } from "@/lib/env";

export type AgentFailure = { status: number; error: string; message: string };

type AuthFailure = {
  status: 401 | 503;
  error: "signed_out" | "auth_unavailable";
  message: string;
};

const AGENT_TIMEOUT_MS = 30_000;

export type AgentRequest = { method?: string; headers?: Record<string, string>; body?: string };

export function agentHeaders(auth: AgentAuth | null): Record<string, string> {
  const headers: Record<string, string> = { "x-agent-secret": serviceSecret() };
  if (auth) headers.authorization = `Bearer ${auth.accessToken}`;
  return headers;
}

export function agentFetch(path: string, auth: AgentAuth | null, init: AgentRequest = {}): Promise<Response> {
  return fetch(`${agentBaseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: { ...init.headers, ...agentHeaders(auth) },
    body: init.body,
    cache: "no-store",
    signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
  });
}

export function isSameOrigin(req: Request): boolean {
  return isAllowedOrigin(req.headers.get("origin"), appOrigin());
}

export function authFailureOf(e: unknown): AuthFailure {
  if (e instanceof SignedOut) return { status: 401, error: "signed_out", message: AUTH_ERROR_COPY.signed_out };
  if (e instanceof AuthUnavailable) return { status: 503, error: "auth_unavailable", message: AUTH_ERROR_COPY.auth_unavailable };
  throw e;
}

export function unreachableOf(e: unknown): AgentFailure {
  if (e instanceof ConfigError) throw e;
  return { status: 502, error: "agent_unreachable", message: "The agent isn't reachable." };
}
