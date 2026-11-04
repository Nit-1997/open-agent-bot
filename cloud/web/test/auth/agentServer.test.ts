import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentHeaders } from "@/lib/agentServer";
import { getAgentAuth, SignedOut } from "@/lib/auth";
import { bffRoute } from "@/lib/bff";
import { ConfigError } from "@/lib/env";
import { AGENT_URL, APP_ORIGIN, AUTH, headersOf, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAgentAuth: vi.fn(),
}));

const MAX_FORWARD_BODY_BYTES = 1024 * 1024;

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

const browserRequest = (method: string, origin: string | null, body?: string, path = "/api/profile") =>
  new Request(`${APP_ORIGIN}${path}`, {
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

describe("forwarding through the bff", () => {
  it("rejects a cross-origin write before calling the agent", async () => {
    const res = await bffRoute(browserRequest("PUT", "https://evil.test", "{}"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses bodies over the forward cap without calling the agent", async () => {
    vi.mocked(getAgentAuth).mockResolvedValue({ userId: "u", accessToken: "t" });
    const res = await bffRoute(browserRequest("PUT", APP_ORIGIN, "x".repeat(MAX_FORWARD_BODY_BYTES + 1)));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a write with no Origin header", async () => {
    expect((await bffRoute(browserRequest("POST", null, "{}", "/api/settings/brave-search/key"))).status).toBe(403);
  });

  it("sends only the server's credentials and the content type", async () => {
    const res = await bffRoute(browserRequest("PUT", APP_ORIGIN, '{"profile":{}}'));
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
    await bffRoute(browserRequest("GET", null));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].body).toBeUndefined();
  });

  it("answers 401 signed_out without a session", async () => {
    vi.mocked(getAgentAuth).mockRejectedValue(new SignedOut("signed_out"));
    const res = await bffRoute(browserRequest("GET", null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed_out", message: "You were signed out. Sign in again." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the agent's status, error body and Retry-After through", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "rate_limited", retryAfter: 9 }, { status: 429, headers: { "retry-after": "9" } }));
    const res = await bffRoute(browserRequest("GET", null));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 9 });
  });

  it("maps an unreachable agent to 502 agent_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await bffRoute(browserRequest("GET", null));
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
    await expect(bffRoute(browserRequest("GET", null))).rejects.toThrow("AGENT_URL is not set");
  });
});
