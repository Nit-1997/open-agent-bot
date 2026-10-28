import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { agentHeaders, agentUrl } from "@/lib/agentServer";

const copilotRuntime = new CopilotRuntime({
  agents: { openagent: new HttpAgent({ url: agentUrl("/agui"), headers: agentHeaders() }) },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({ runtime: copilotRuntime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
