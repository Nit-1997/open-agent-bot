import { parsePage } from "@shared/pages";
import { isEntityKind } from "@shared/workspace";
import { forwardToAgent, jsonError } from "@/lib/agentServer";

export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const page = parsePage(params.get("page"));
  if (page === null) return jsonError(400, "invalid", "That page number isn't valid.");
  const kind = params.get("kind") ?? "";
  if (kind && !isEntityKind(kind)) return jsonError(400, "invalid", "kind must be cart, trip, event or shortlist");
  return forwardToAgent(req, `/plans?page=${page}${kind ? `&kind=${kind}` : ""}`);
}
