import { forwardToAgent, jsonError } from "@/lib/agentServer";
import { isUuid } from "@/lib/ids";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "This chat doesn't exist.");
  return forwardToAgent(req, `/chats/${id}/messages`);
}
