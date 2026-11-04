import { type ActionResult, failure } from "@/lib/actionResult";
import { type AgentFailure, type AgentRequest, agentFetch, authFailureOf, unreachableOf } from "@/lib/agentServer";
import { type ApiErrorBody, apiErrorMessage } from "@oab/ui/lib/apiErrors.ts";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";

const asFailure = (f: AgentFailure) => failure(f.status, f.error, f.message);

export async function callAgent<T>(path: string, auth: AgentAuth | null, init: AgentRequest = {}): Promise<ActionResult<T>> {
  let res: Response;
  try {
    res = await agentFetch(path, auth, init);
  } catch (e) {
    return asFailure(unreachableOf(e));
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
    return asFailure(authFailureOf(e));
  }
  return fn(auth);
}

export const jsonBody = (value: unknown): AgentRequest => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});
