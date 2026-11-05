import { isAllowedOrigin, jsonError } from "@oab/bff";
import { agentHeaders, authFailureOf, unreachableOf } from "@/lib/agentServer";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";
import { clientIp } from "@/lib/authForms";
import { agentBaseUrl, appOrigin } from "@/lib/env";

const TIMEOUT_MS = 15_000;
const TOKEN_MAX = 2048;

export async function POST(req: Request): Promise<Response> {
  if (!isAllowedOrigin(req.headers.get("origin"), appOrigin())) return jsonError(403, "bad_origin");
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = body?.token;
  if (typeof token !== "string" || token.length < 1 || token.length > TOKEN_MAX)
    return jsonError(400, "invalid", "We couldn't verify that. Try again.");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    const f = authFailureOf(e);
    return jsonError(f.status, f.error, f.message);
  }
  const ip = clientIp(req.headers);
  let upstream: Response;
  try {
    upstream = await fetch(`${agentBaseUrl()}/human-check`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip && { "x-client-ip": ip }), ...agentHeaders(auth) },
      body: JSON.stringify({ token }),
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
  const out = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "private, no-store",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) out.set("retry-after", retryAfter);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
