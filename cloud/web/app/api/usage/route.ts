import { isAllowedOrigin, jsonError } from "@oab/bff";
import { agentHeaders, authFailureOf, unreachableOf } from "@/lib/agentServer";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";
import { agentBaseUrl, appOrigin } from "@/lib/env";

const TIMEOUT_MS = 10_000;

export async function GET(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin, appOrigin())) return jsonError(403, "bad_origin");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    const f = authFailureOf(e);
    return jsonError(f.status, f.error, f.message);
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${agentBaseUrl()}/usage`, {
      method: "GET",
      headers: agentHeaders(auth),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const f = unreachableOf(e);
    return jsonError(f.status, f.error, f.message);
  }
  if (upstream.type === "opaqueredirect" || (upstream.status >= 300 && upstream.status < 400)) {
    await upstream.body?.cancel().catch(() => {});
    const f = unreachableOf(new Error("redirect"));
    return jsonError(f.status, f.error, f.message);
  }
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "private, no-store",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(upstream.body, { status: upstream.status, headers });
}
