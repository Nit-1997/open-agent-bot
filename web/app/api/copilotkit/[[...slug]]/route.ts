import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { agentHeaders, agentUrl, authFailure, isSafeMethod, isSameOrigin, jsonError } from "@/lib/agentServer";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";
import { UserScopedRunner, withRunnerUser } from "@/lib/copilotRunner";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const FORWARDED_HEADERS = ["content-type", "accept"];

let handler: ReturnType<typeof handle> | undefined;

function endpoint(): ReturnType<typeof handle> {
  if (handler) return handler;
  const runtime = new CopilotRuntime({
    agents: async () => {
      const auth = await getAgentAuth();
      return { openagent: new HttpAgent({ url: agentUrl("/agui"), headers: agentHeaders(auth) }) };
    },
    runner: new UserScopedRunner(),
    forwardHeaders: { useDefaultDenylist: true, denyPrefixes: ["x-"], deny: ["authorization", "cookie"] },
  });
  handler = handle(createCopilotEndpoint({ runtime, basePath: "/api/copilotkit" }));
  return handler;
}

function withoutBrowserHeaders(req: Request): Request {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = !isSafeMethod(req.method) && req.body !== null;
  return new Request(req.url, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    signal: req.signal,
    ...(hasBody && { duplex: "half" }),
  } as RequestInit);
}

async function route(req: Request): Promise<Response> {
  if (!isSafeMethod(req.method) && !isSameOrigin(req)) return jsonError(403, "bad_origin");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    return authFailure(e);
  }
  return withRunnerUser(auth.userId, () => endpoint()(withoutBrowserHeaders(req)));
}

export { route as DELETE, route as GET, route as PATCH, route as POST };
