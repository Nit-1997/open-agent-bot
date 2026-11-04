import { type AuthOutcome, type BffHandler, createBff } from "@oab/bff";
import { agentHeaders, authFailureOf } from "@/lib/agentServer";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";
import { agentBaseUrl, appOrigin } from "@/lib/env";

async function hostedAuth(): Promise<AuthOutcome> {
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    return { ok: false, ...authFailureOf(e) };
  }
  return { ok: true, headers: agentHeaders(auth) };
}

let built: { key: string; handler: BffHandler } | undefined;

function hostedBff(): BffHandler {
  const agentUrl = agentBaseUrl();
  const origin = appOrigin();
  const key = `${agentUrl} ${origin}`;
  if (built?.key !== key) built = { key, handler: createBff({ agentUrl, appOrigin: origin, auth: hostedAuth }) };
  return built.handler;
}

type NextRouteHandler = (req: Request, context?: { params: Promise<unknown> }) => Promise<Response>;

export const bffRoute: NextRouteHandler = async (req) => hostedBff()(req);
