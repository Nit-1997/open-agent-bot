import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";

const agentUrl = `${process.env.AGENT_URL ?? "http://localhost:8000"}/agui`;
const headers: Record<string, string> = process.env.AGENT_SHARED_SECRET ? { "x-agent-secret": process.env.AGENT_SHARED_SECRET } : {};

const copilotRuntime = new CopilotRuntime({
  agents: { openagent: new HttpAgent({ url: agentUrl, headers }) },
  runner: new InMemoryAgentRunner(),
});

const app = createCopilotEndpoint({ runtime: copilotRuntime, basePath: "/api/copilotkit" });

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
