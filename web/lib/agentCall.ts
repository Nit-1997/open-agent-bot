import { type AgentRequest, agentFetch } from "@/lib/agentServer";
import { type ApiErrorBody, apiErrorMessage } from "@/lib/apiErrors";
import { type AgentAuth, AuthUnavailable, getAgentAuth, SignedOut } from "@/lib/auth";
import { type ActionResult, failure } from "@/lib/actionResult";
import { AUTH_ERROR_COPY } from "@/lib/authErrors";
import { ConfigError } from "@/lib/env";

export async function callAgent<T>(path: string, auth: AgentAuth | null, init: AgentRequest = {}): Promise<ActionResult<T>> {
  let res: Response;
  try {
    res = await agentFetch(path, auth, init);
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    return failure(502, "agent_unreachable", "The agent isn't reachable.");
  }
  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) return failure(res.status, typeof body.error === "string" ? body.error : "upstream", apiErrorMessage(res.status, body));
  return { ok: true, data: body };
}

export async function withAgentAuth<T>(fn: (auth: AgentAuth) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    if (e instanceof SignedOut) return failure(401, "signed_out", AUTH_ERROR_COPY.signed_out);
    if (e instanceof AuthUnavailable) return failure(503, "auth_unavailable", AUTH_ERROR_COPY.auth_unavailable);
    throw e;
  }
  return fn(auth);
}

export const jsonBody = (value: unknown): AgentRequest => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
