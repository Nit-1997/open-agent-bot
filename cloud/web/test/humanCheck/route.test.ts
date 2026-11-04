import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/human-check/route";
import { getAgentAuth, SignedOut } from "@/lib/auth";
import { AGENT_URL, APP_ORIGIN, AUTH, headersOf, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAgentAuth: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stubAgentEnv();
  vi.mocked(getAgentAuth).mockResolvedValue(AUTH);
  fetchMock = vi.fn(async () => Response.json({ humanCheck: "done" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const req = (body: unknown, headers: Record<string, string> = { origin: APP_ORIGIN }) =>
  new Request(`${APP_ORIGIN}/api/human-check`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/human-check", () => {
  it("forwards only the token with the service secret, the user's token and the first x-forwarded-for hop as x-client-ip", async () => {
    const res = await POST(
      req({ token: "tok-1", userId: "someone-else" }, { origin: APP_ORIGIN, "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ humanCheck: "done" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AGENT_URL}/human-check`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ token: "tok-1" });
    const h = headersOf(fetchMock.mock.calls[0]);
    expect(h.get("x-agent-secret")).toBe(SERVICE_SECRET);
    expect(h.get("authorization")).toBe(`Bearer ${AUTH.accessToken}`);
    expect(h.get("x-client-ip")).toBe("203.0.113.7");
  });

  it("refuses a missing or foreign Origin with 403 before anything else", async () => {
    expect((await POST(req({ token: "t" }, {}))).status).toBe(403);
    const res = await POST(req({ token: "t" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_origin" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a missing, empty, non-string or oversized token with 400", async () => {
    for (const body of [{}, { token: "" }, { token: 7 }, { token: "x".repeat(2049) }, "not json"])
      expect((await POST(req(body))).status, JSON.stringify(body)).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    vi.mocked(getAgentAuth).mockRejectedValueOnce(new SignedOut());
    const res = await POST(req({ token: "t" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "signed_out" });
  });

  it("passes the agent's refusals and retry-after through", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "human_check_failed", message: "We couldn't verify that. Try again." }, { status: 403 }),
    );
    expect((await POST(req({ token: "t" }))).status).toBe(403);
    fetchMock.mockResolvedValueOnce(Response.json({ error: "human_check_unavailable" }, { status: 503, headers: { "retry-after": "60" } }));
    const res = await POST(req({ token: "t" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("answers 502 when the agent is unreachable or redirects", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await POST(req({ token: "t" }))).status).toBe(502);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://elsewhere" } }));
    expect((await POST(req({ token: "t" }))).status).toBe(502);
  });
});
