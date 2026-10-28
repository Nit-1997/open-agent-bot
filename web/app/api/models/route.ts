import { agentHeaders, agentUrl } from "@/lib/agentServer";

export async function GET() {
  try {
    const upstream = await fetch(agentUrl("/models"), { headers: agentHeaders(), cache: "no-store" });
    if (!upstream.ok) return Response.json({ error: "unavailable" }, { status: 502 });
    return Response.json(await upstream.json());
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
