import { normalizeId } from "@shared/ids";
import { forwardToAgent, jsonError } from "@/lib/agentServer";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = normalizeId((await params).id);
  if (!id) return jsonError(404, "not_found", "This chat doesn't exist.");
  return forwardToAgent(req, `/chats/${id}/messages`);
}
