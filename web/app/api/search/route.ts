import { isSearchScope, normalizeQuery, SEARCH_MAX, SEARCH_MIN, searchOffsetOk } from "@oab/shared/lists";
import { parsePage } from "@oab/shared/pages";
import { forwardToAgent, jsonError } from "@/lib/agentServer";

export function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = normalizeQuery(params.get("q") ?? "");
  if (!q) return jsonError(400, "invalid", `Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.`);
  const scope = params.get("scope") || "all";
  if (!isSearchScope(scope)) return jsonError(400, "invalid", "scope must be all, chats or reports");
  const page = parsePage(params.get("page"));
  if (page === null || !searchOffsetOk(page)) return jsonError(400, "invalid", "That page number isn't valid.");
  return forwardToAgent(req, `/search?q=${encodeURIComponent(q)}&scope=${scope}&page=${page}`);
}
