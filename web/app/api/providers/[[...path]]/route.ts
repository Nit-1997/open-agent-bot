import { agentHeaders, agentUrl } from "@/lib/agentServer";

const ALLOWED = /^(local|test|logins\/[0-9a-f-]{36}(\/answer)?|[a-z0-9-]+(\/(key|models|login))?)?$/;

async function forward(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const sub = ((await params).path ?? []).join("/");
  if (!ALLOWED.test(sub)) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const upstream = await fetch(agentUrl(`/providers${sub ? `/${sub}` : ""}`), {
      method: req.method,
      headers: agentHeaders({ "content-type": "application/json" }),
      body: req.method === "GET" || req.method === "DELETE" ? undefined : await req.text(),
      cache: "no-store",
    });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
  } catch {
    return Response.json({ error: "The agent isn't reachable." }, { status: 502 });
  }
}

export { forward as DELETE, forward as GET, forward as POST, forward as PUT };
