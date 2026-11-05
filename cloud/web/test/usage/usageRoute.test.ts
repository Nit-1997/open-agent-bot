import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/usage/route";
import { AuthUnavailable, getAgentAuth, SignedOut } from "@/lib/auth";
import { AGENT_URL, APP_ORIGIN, AUTH, headersOf, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAgentAuth: vi.fn() }));

const VIEW = {
  month: { used: 3, limit: 50, resetsAt: "2026-12-01T00:00:00.000Z" },
  hour: { used: 1, limit: 10, resetsAt: "2026-11-04T13:00:00.000Z" },
  running: { mine: 0, limit: 1 },
  humanCheck: "off",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubAgentEnv();
  vi.mocked(getAgentAuth).mockResolvedValue(AUTH);
  fetchMock = vi.fn(async () => Response.json(VIEW));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const req = (headers: Record<string, string> = {}) => new Request(`${APP_ORIGIN}/api/usage`, { headers });

describe("GET /api/usage", () => {
  it("forwards to the agent's /usage with the service secret and the user's token", async () => {
    const res = await GET(req({ origin: APP_ORIGIN }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VIEW);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/usage`);
    expect(init.method).toBe("GET");
    expect(init.cache).toBe("no-store");
    const headers = headersOf(fetchMock.mock.calls[0]);
    expect(headers.get("x-agent-secret")).toBe(SERVICE_SECRET);
    expect(headers.get("authorization")).toBe(`Bearer ${AUTH.accessToken}`);
  });

  it("works without an Origin header (same-origin GET)", async () => {
    expect((await GET(req())).status).toBe(200);
  });

  it("passes the agent's refusal status, body and retry-after through", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: "usage_unavailable", message: "Can't check your usage right now. Try again in a minute.", retryAfter: 60 },
        { status: 503, headers: { "retry-after": "60" } },
      ),
    );
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({ error: "usage_unavailable" });
  });

  it("refuses a foreign origin without calling the agent", async () => {
    const res = await GET(req({ origin: "https://evil.test" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [new SignedOut(), 401, "signed_out"],
    [new AuthUnavailable(), 503, "auth_unavailable"],
  ])("answers %s without calling the agent", async (err, status, error) => {
    vi.mocked(getAgentAuth).mockRejectedValueOnce(err);
    const res = await GET(req());
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 502 when the agent isn't reachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await GET(req());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "agent_unreachable", message: "The agent isn't reachable." });
  });

  it("answers 502 instead of following an agent redirect", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://elsewhere.test" } }));
    const res = await GET(req());
    expect(res.status).toBe(502);
  });
});
