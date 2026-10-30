import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { agentHeaders, agentUrl } from "@/lib/agentServer";

let handler: ReturnType<typeof handle> | undefined;

function endpoint(): ReturnType<typeof handle> {
  if (handler) return handler;
  const copilotRuntime = new CopilotRuntime({
    agents: { openagent: new HttpAgent({ url: agentUrl("/agui"), headers: agentHeaders() }) },
    runner: new InMemoryAgentRunner(),
  });
  handler = handle(createCopilotEndpoint({ runtime: copilotRuntime, basePath: "/api/copilotkit" }));
  return handler;
}

const route = (req: Request) => endpoint()(req);

export { route as DELETE, route as GET, route as PATCH, route as POST };
