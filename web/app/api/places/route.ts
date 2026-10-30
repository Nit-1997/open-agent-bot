import { forwardToAgent } from "@/lib/agentServer";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return forwardToAgent(req, `/places?q=${encodeURIComponent(q.slice(0, 200))}`);
}
