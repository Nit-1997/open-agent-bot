import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentHeaders, forwardToAgent } from "@/lib/agentServer";
import { getAgentAuth, SignedOut } from "@/lib/auth";
import { ConfigError } from "@/lib/env";
import { AGENT_URL, APP_ORIGIN, AUTH, headersOf, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAgentAuth: vi.fn(),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubAgentEnv();
  vi.mocked(getAgentAuth).mockResolvedValue(AUTH);
  fetchMock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const browserRequest = (method: string, origin: string | null, body?: string) =>
  new Request(`${APP_ORIGIN}/api/profile`, {
    method,
    body,
    headers: {
      "content-type": "application/json",
      ...(origin && { origin }),
      cookie: "sb-access=browser-cookie",
      authorization: "Bearer browser-token",
      "x-agent-secret": "browser-secret",
      "x-client-ip": "6.6.6.6",
      "x-forwarded-for": "7.7.7.7",
    },
  });

describe("forwardToAgent", () => {
  it("rejects a cross-origin write before calling the agent", async () => {
    const res = await forwardToAgent(browserRequest("PUT", "https://evil.test", "{}"), "/profile");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a write with no Origin header", async () => {
    expect((await forwardToAgent(browserRequest("POST", null, "{}"), "/profile")).status).toBe(403);
  });

  it("sends only the server's credentials and the content type", async () => {
    const res = await forwardToAgent(browserRequest("PUT", APP_ORIGIN, '{"profile":{}}'), "/profile");
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/profile`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"profile":{}}');
    expect([...headersOf([url, init]).entries()].sort()).toEqual([
      ["authorization", `Bearer ${AUTH.accessToken}`],
      ["content-type", "application/json"],
      ["x-agent-secret", SERVICE_SECRET],
    ]);
  });

  it("lets same-site GETs through without an Origin header", async () => {
    await forwardToAgent(browserRequest("GET", null), "/profile");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBeUndefined();
  });

  it("answers 401 signed_out without a session", async () => {
    vi.mocked(getAgentAuth).mockRejectedValue(new SignedOut("signed_out"));
    const res = await forwardToAgent(browserRequest("GET", null), "/profile");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed_out" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the agent's status, error body and Retry-After through", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "rate_limited", retryAfter: 9 }, { status: 429, headers: { "retry-after": "9" } }));
    const res = await forwardToAgent(browserRequest("GET", null), "/profile");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 9 });
  });

  it("maps an unreachable agent to 502 agent_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await forwardToAgent(browserRequest("GET", null), "/profile");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("agent_unreachable");
  });
});

describe("agent configuration", () => {
  it("refuses to run without the service secret", () => {
    vi.stubEnv("AGENT_SERVICE_SECRET", "");
    expect(() => agentHeaders(AUTH)).toThrow(new ConfigError("AGENT_SERVICE_SECRET is not set"));
  });

  it("rejects a malformed secret and has no default agent URL", async () => {
    vi.stubEnv("AGENT_SERVICE_SECRET", "short");
    expect(() => agentHeaders(null)).toThrow("AGENT_SERVICE_SECRET is invalid");
    stubAgentEnv();
    vi.stubEnv("AGENT_URL", "");
    await expect(forwardToAgent(browserRequest("GET", null), "/profile")).rejects.toThrow("AGENT_URL is not set");
  });
});
