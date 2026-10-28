import { ARTIFACT_CSP } from "@shared/artifacts";
import { agentHeaders, agentUrl } from "@/lib/agentServer";

const ID_RE = /^[A-Za-z0-9_-]{12}$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return new Response("not found", { status: 404 });
  const pdf = new URL(req.url).searchParams.get("format") === "pdf";
  let upstream: Response;
  try {
    upstream = await fetch(agentUrl(`/artifacts/${id}${pdf ? ".pdf" : ""}`), { headers: agentHeaders(), cache: "no-store" });
  } catch {
    return new Response("the agent isn't reachable", { status: 502 });
  }
  if (!upstream.ok) return new Response("not found", { status: upstream.status === 404 ? 404 : 502 });
  if (pdf) {
    return new Response(upstream.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="${id}.pdf"`,
      },
    });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": ARTIFACT_CSP,
      "x-content-type-options": "nosniff",
    },
  });
}
