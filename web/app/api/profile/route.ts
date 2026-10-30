import { forwardToAgent } from "@/lib/agentServer";

const forward = (req: Request) => forwardToAgent(req, "/profile");

export { forward as GET, forward as PUT };
