const ID_RE = /^[A-Za-z0-9_-]{12}$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID_RE.test(id)) return new Response("not found", { status: 404 });
  const pdf = new URL(req.url).searchParams.get("format") === "pdf";
  const base = process.env.AGENT_URL ?? "http://localhost:8000";
  const headers: Record<string, string> = process.env.AGENT_SHARED_SECRET ? { "x-agent-secret": process.env.AGENT_SHARED_SECRET } : {};
  const upstream = await fetch(`${base}/artifacts/${id}${pdf ? ".pdf" : ""}`, { headers, cache: "no-store" });
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
      "content-security-policy": "sandbox allow-scripts",
      "x-content-type-options": "nosniff",
    },
  });
}
