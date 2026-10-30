import { forwardToAgent } from "@/lib/agentServer";

const ALLOWED = /^(local|test|logins\/[0-9a-f-]{36}(\/answer)?|[a-z0-9-]+(\/(key|models|login))?)?$/;

async function forward(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const sub = ((await params).path ?? []).join("/");
  if (!ALLOWED.test(sub)) return Response.json({ error: "not found" }, { status: 404 });
  return forwardToAgent(req, `/providers${sub ? `/${sub}` : ""}`);
}

export { forward as DELETE, forward as GET, forward as POST, forward as PUT };
