import { parseRoute } from "@shared/routes";
import { forwardToAgent, jsonError } from "@/lib/agentServer";

export async function GET(req: Request, { params }: { params: Promise<{ chatId: string; kind: string; key: string }> }) {
  const { chatId, kind, key } = await params;
  const route = parseRoute(`/plans/${chatId}/${kind}/${key}`);
  if (route?.section !== "plan") return jsonError(404, "not_found", "This plan doesn't exist.");
  return forwardToAgent(req, `/plans/${route.chatId}/${route.kind}/${route.key}`);
}
