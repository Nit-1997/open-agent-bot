import type { AbstractAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { isUuid } from "@oab/shared/ids";
import { type Context, Hono } from "hono";
import { currentCaller, UserScopedRunner, withCaller } from "../copilot/callerScope.js";
import type { ConnectSlots, ThreadOwners } from "../copilot/owners.js";
import { withHeartbeat } from "../copilot/sseHeartbeat.js";
import { hasThreadId, readThreadBody } from "../copilot/threadBody.js";
import type { AuthEnv, Principal } from "../identity/types.js";
import { UserError } from "../lib/errors.js";
import { HEARTBEAT_MS } from "./agui.js";
import { errorResponse, safe } from "./handlers.js";

export const COPILOTKIT_BASE = "/copilotkit";
export const COPILOTKIT_AGENT_ID = "openagent";
export const COPILOTKIT_RUN_PATH = `${COPILOTKIT_BASE}/agent/${COPILOTKIT_AGENT_ID}/run`;

const FORWARDED_HEADERS = ["content-type", "accept"];
const REQUEST_OWNER = "";

export type CopilotDeps = {
  agent: (principal: Principal) => AbstractAgent;
  owners: ThreadOwners;
  chatExists: (userId: string, threadId: string) => Promise<boolean>;
  slots: ConnectSlots;
  connectMaxMs: number;
  heartbeatMs?: number;
};

type C = Context<AuthEnv>;

const notFound = (c: C) => errorResponse(c, new UserError("Not found.", "not_found"));
const methodNotAllowed = (c: C) => c.json({ error: "method_not_allowed", message: "Method not allowed." }, 405);
const invalidThread = (c: C) => errorResponse(c, new UserError("threadId must be a chat id", "invalid"));
const forbidden = (c: C) => errorResponse(c, new UserError("That chat belongs to someone else.", "forbidden"));
const tooMany = (c: C) =>
  errorResponse(
    c,
    new UserError("Too many open chat streams. Close a tab and try again.", "rate_limited", { code: "too_many_connections" }),
  );

function pinned(c: C, method: string): Response | undefined {
  const agentId = c.req.param("agentId");
  if (agentId !== undefined && agentId !== COPILOTKIT_AGENT_ID) return notFound(c);
  if (c.req.method !== method) return methodNotAllowed(c);
  return undefined;
}

function threadIdOf(body: Record<string, unknown> | null): string | undefined {
  if (!hasThreadId(body) || !isUuid(body.threadId)) return undefined;
  return body.threadId.toLowerCase();
}

function toRuntime(c: C, path: string, body?: string): Request {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  return new Request(new URL(path, c.req.url), { method: c.req.method, headers, body, signal: c.req.raw.signal });
}

type StreamResponse = Response & { body: ReadableStream<Uint8Array> };

const isStream = (res: Response): res is StreamResponse =>
  res.body !== null && (res.headers.get("content-type") ?? "").startsWith("text/event-stream");

export function copilotkitRoutes(deps: CopilotDeps) {
  const runner = new UserScopedRunner();
  const runtime = new CopilotRuntime({
    agents: async () => ({ [COPILOTKIT_AGENT_ID]: deps.agent(currentCaller()) }),
    runner,
    forwardHeaders: { useDefaultDenylist: true, denyPrefixes: ["x-"], deny: ["authorization", "cookie"] },
    sseKeepAliveIntervalSeconds: 0,
  });
  const endpoint = createCopilotEndpoint({ runtime, basePath: COPILOTKIT_BASE });
  const intervalMs = deps.heartbeatMs ?? HEARTBEAT_MS;

  const forward = (user: Principal, req: Request) => withCaller(user, () => endpoint.fetch(req));

  const beating = (res: StreamResponse, extra: { maxMs?: number; onClose?: () => void } = {}) =>
    new Response(withHeartbeat(res.body, { intervalMs, ...extra }), { status: res.status, headers: res.headers });

  async function mayReach(user: Principal, threadId: string): Promise<boolean> {
    const owner = deps.owners.ownerOf(threadId);
    if (owner) return owner === user.id;
    if (await deps.chatExists(user.id, threadId)) return true;
    return withCaller(user, () => runner.isRunning({ threadId, ownerId: REQUEST_OWNER }));
  }

  const app = new Hono<AuthEnv>();

  app.all(
    `${COPILOTKIT_BASE}/info`,
    safe<AuthEnv>((c) => pinned(c, "GET") ?? forward(c.get("user"), toRuntime(c, `${COPILOTKIT_BASE}/info`))),
  );

  app.all(
    `${COPILOTKIT_BASE}/agent/:agentId/run`,
    safe<AuthEnv>(async (c) => {
      const refused = pinned(c, "POST");
      if (refused) return refused;
      const user = c.get("user");
      const body = await readThreadBody(c.req.raw);
      const threadId = threadIdOf(body);
      if (!threadId) return invalidThread(c);
      const owner = deps.owners.ownerOf(threadId);
      if (owner && owner !== user.id) return forbidden(c);
      const res = await forward(user, toRuntime(c, COPILOTKIT_RUN_PATH, JSON.stringify({ ...body, threadId })));
      return isStream(res) ? beating(res) : res;
    }),
  );

  app.all(
    `${COPILOTKIT_BASE}/agent/:agentId/connect`,
    safe<AuthEnv>(async (c) => {
      const refused = pinned(c, "POST");
      if (refused) return refused;
      const user = c.get("user");
      const release = deps.slots.acquire(user.id);
      if (!release) return tooMany(c);
      let handedOff = false;
      try {
        const body = await readThreadBody(c.req.raw);
        const threadId = threadIdOf(body);
        if (!threadId) return invalidThread(c);
        if (!(await mayReach(user, threadId))) return forbidden(c);
        const path = `${COPILOTKIT_BASE}/agent/${COPILOTKIT_AGENT_ID}/connect`;
        const res = await forward(user, toRuntime(c, path, JSON.stringify({ ...body, threadId })));
        if (!isStream(res)) return res;
        handedOff = true;
        return beating(res, { maxMs: deps.connectMaxMs, onClose: release });
      } finally {
        if (!handedOff) release();
      }
    }),
  );

  app.all(
    `${COPILOTKIT_BASE}/agent/:agentId/stop/:threadId`,
    safe<AuthEnv>(async (c) => {
      const refused = pinned(c, "POST");
      if (refused) return refused;
      const raw = c.req.param("threadId");
      if (!isUuid(raw)) return notFound(c);
      const threadId = raw.toLowerCase();
      const user = c.get("user");
      if (!(await mayReach(user, threadId))) return forbidden(c);
      const path = `${COPILOTKIT_BASE}/agent/${COPILOTKIT_AGENT_ID}/stop/${threadId}`;
      return forward(user, toRuntime(c, path, await c.req.text()));
    }),
  );

  return app;
}
