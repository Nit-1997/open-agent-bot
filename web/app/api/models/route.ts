export async function GET() {
  const base = process.env.AGENT_URL ?? "http://localhost:8000";
  const headers: Record<string, string> = process.env.AGENT_SHARED_SECRET ? { "x-agent-secret": process.env.AGENT_SHARED_SECRET } : {};
  try {
    const upstream = await fetch(`${base}/models`, { headers, cache: "no-store" });
    if (!upstream.ok) return Response.json({ error: "unavailable" }, { status: 502 });
    return Response.json(await upstream.json());
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
