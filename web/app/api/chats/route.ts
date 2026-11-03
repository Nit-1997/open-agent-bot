import { forwardToAgent, jsonError } from "@/lib/agentServer";
import { parsePage } from "@oab/shared/pages";

export function GET(req: Request) {
  const page = parsePage(new URL(req.url).searchParams.get("page"));
  if (page === null) return jsonError(400, "invalid", "That page number isn't valid.");
  return forwardToAgent(req, `/chats?page=${page}`);
}
