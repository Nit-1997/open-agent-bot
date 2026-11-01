import { forwardToAgent } from "@/lib/agentServer";

export function GET(req: Request) {
  return forwardToAgent(req, "/models");
}
