import { parsePage } from "@oab/shared/pages";
import { forwardToAgent, jsonError } from "@/lib/agentServer";

export function GET(req: Request) {
  const page = parsePage(new URL(req.url).searchParams.get("page"));
  if (page === null) return jsonError(400, "invalid", "That page number isn't valid.");
  return forwardToAgent(req, `/reports?page=${page}`);
}
