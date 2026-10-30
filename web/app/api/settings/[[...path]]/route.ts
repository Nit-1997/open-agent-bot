import { forwardToAgent } from "@/lib/agentServer";

const ALLOWED = /^(brave-search(\/key)?)?$/;

async function forward(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const sub = ((await params).path ?? []).join("/");
  if (!ALLOWED.test(sub)) return Response.json({ error: "not found" }, { status: 404 });
  return forwardToAgent(req, `/settings${sub ? `/${sub}` : ""}`);
}

export { forward as DELETE, forward as GET, forward as POST };
