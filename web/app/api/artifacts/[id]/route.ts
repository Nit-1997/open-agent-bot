import { ARTIFACT_CSP, ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import { agentFetch, authFailure, jsonError, unreachableUnlessMisconfigured } from "@/lib/agentServer";
import { artifactErrorPage, type Format, formatOf, isFramedReport } from "@/lib/artifactFrame";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";

const PRIVATE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const PASSTHROUGH = [401, 403, 404, 429];

const SUFFIX: Record<Format, string> = { html: "", pdf: ".pdf", thumb: ".jpg" };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await proxy(id, formatOf(req));
  return isFramedReport(req) && !res.ok ? artifactErrorPage(res, `/api/artifacts/${id}`) : res;
}

async function proxy(id: string, format: Format): Promise<Response> {
  if (!ARTIFACT_ID_RE.test(id)) return jsonError(404, "not_found");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    return authFailure(e);
  }
  let upstream: Response;
  try {
    upstream = await agentFetch(`/artifacts/${id}${SUFFIX[format]}`, auth);
  } catch (e) {
    return unreachableUnlessMisconfigured(e);
  }
  if (!upstream.ok) {
    const retryAfter = upstream.headers.get("retry-after");
    return new Response(upstream.body, {
      status: PASSTHROUGH.includes(upstream.status) ? upstream.status : 502,
      headers: {
        ...PRIVATE,
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        ...(retryAfter && { "retry-after": retryAfter }),
      },
    });
  }
  if (format === "pdf") {
    return new Response(upstream.body, {
      headers: {
        ...PRIVATE,
        "content-type": "application/pdf",
        "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="${id}.pdf"`,
      },
    });
  }
  if (format === "thumb") return new Response(upstream.body, { headers: { ...PRIVATE, "content-type": "image/jpeg" } });
  return new Response(upstream.body, {
    headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
  });
}
