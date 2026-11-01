import { ARTIFACT_CSP, ARTIFACT_ID_RE } from "@shared/artifacts";
import { agentFetch, authFailure, jsonError, unreachableUnlessMisconfigured } from "@/lib/agentServer";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";

const PRIVATE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ARTIFACT_ID_RE.test(id)) return jsonError(404, "not_found");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    return authFailure(e);
  }
  const pdf = new URL(req.url).searchParams.get("format") === "pdf";
  let upstream: Response;
  try {
    upstream = await agentFetch(`/artifacts/${id}${pdf ? ".pdf" : ""}`, auth);
  } catch (e) {
    return unreachableUnlessMisconfigured(e);
  }
  if (!upstream.ok) {
    const passthrough = [401, 403, 404, 429].includes(upstream.status);
    return new Response(upstream.body, {
      status: passthrough ? upstream.status : 502,
      headers: { ...PRIVATE, "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }
  if (pdf) {
    return new Response(upstream.body, {
      headers: {
        ...PRIVATE,
        "content-type": "application/pdf",
        "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="${id}.pdf"`,
      },
    });
  }
  return new Response(upstream.body, {
    headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
  });
}
