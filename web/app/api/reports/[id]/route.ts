import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import { forwardToAgent, jsonError } from "@/lib/agentServer";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ARTIFACT_ID_RE.test(id)) return jsonError(404, "not_found", "That report doesn't exist.");
  return forwardToAgent(req, `/reports/${id}`);
}
