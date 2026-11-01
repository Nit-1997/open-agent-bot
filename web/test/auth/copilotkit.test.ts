// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/copilotkit/[[...slug]]/route";
import { getAgentAuth, SignedOut } from "@/lib/auth";
import { AGENT_URL, APP_ORIGIN, AUTH, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAgentAuth: vi.fn(),
}));

const THREAD = "22222222-2222-4222-8222-222222222222";

const SSE = [
  { type: "RUN_STARTED", threadId: THREAD, runId: "r1" },
  { type: "RUN_FINISHED", threadId: THREAD, runId: "r1" },
]
  .map((e) => `data: ${JSON.stringify(e)}\n\n`)
  .join("");

let agentCalls: Array<{ url: string; headers: Headers }>;

beforeEach(() => {
  stubAgentEnv();
  vi.mocked(getAgentAuth).mockResolvedValue(AUTH);
  agentCalls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      agentCalls.push({ url: String(url), headers: new Headers(init?.headers) });
      return new Response(SSE, { headers: { "content-type": "text/event-stream" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function runRequest(origin: string = APP_ORIGIN): Request {
  return new Request(`${APP_ORIGIN}/api/copilotkit/agent/openagent/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      origin,
      cookie: "sb-token=browser-cookie",
      authorization: "Bearer browser-token",
      "x-agent-secret": "browser-secret",
      "x-client-ip": "6.6.6.6",
      "x-user-id": "someone-else",
    },
    body: JSON.stringify({
      threadId: THREAD,
      runId: "r1",
      messages: [{ id: "m1", role: "user", content: "hi" }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  });
}

describe("CopilotKit route", () => {
  it("reaches the agent with only the server's credentials", async () => {
    const res = await POST(runRequest());
    await res.text();
    expect(res.status).toBe(200);
    const call = agentCalls.find((c) => c.url === `${AGENT_URL}/agui`);
    expect(call).toBeDefined();
    const headers = call?.headers ?? new Headers();
    expect(headers.get("authorization")).toBe(`Bearer ${AUTH.accessToken}`);
    expect(headers.get("x-agent-secret")).toBe(SERVICE_SECRET);
    expect(headers.get("x-client-ip")).toBeNull();
    expect(headers.get("x-user-id")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
  });

  it("rejects a cross-origin run before touching the runtime", async () => {
    const res = await POST(runRequest("https://evil.test"));
    expect(res.status).toBe(403);
    expect(agentCalls).toEqual([]);
  });

  it("answers 401 without a session", async () => {
    vi.mocked(getAgentAuth).mockRejectedValue(new SignedOut("signed_out"));
    const res = await POST(runRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed_out", message: "You were signed out. Sign in again." });
    expect(agentCalls).toEqual([]);
  });

  it("doesn't expose the in-memory thread list", async () => {
    const { GET } = await import("@/app/api/copilotkit/[[...slug]]/route");
    const res = await GET(new Request(`${APP_ORIGIN}/api/copilotkit/threads?agentId=openagent`));
    expect(res.status).not.toBe(200);
  });
});
