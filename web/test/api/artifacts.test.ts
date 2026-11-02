import { ARTIFACT_CSP } from "@shared/artifacts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/artifacts/[id]/route";
import { AUTH, headersOf, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getAgentAuth: vi.fn(async () => AUTH),
}));

beforeEach(stubAgentEnv);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const call = (id: string, qs = "") => GET(new Request(`http://localhost/api/artifacts/${id}${qs}`), { params: Promise.resolve({ id }) });
const framed = (id: string) =>
  GET(new Request(`http://localhost/api/artifacts/${id}`, { headers: { "sec-fetch-dest": "iframe" } }), {
    params: Promise.resolve({ id }),
  });

describe("artifacts route", () => {
  it("artifacts route forces sandbox CSP", async () => {
    const fetchMock = vi.fn(async () => new Response("<h1>x</h1>", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("abcdefghijkl");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toBe(ARTIFACT_CSP);
    for (const directive of ["default-src 'none'", "img-src data:", "connect-src 'none'", "form-action 'none'", "base-uri 'none'"])
      expect(csp).toContain(directive);
    expect(csp).toContain("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/artifacts\/abcdefghijkl$/);
    const sent = headersOf(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.get("authorization")).toBe(`Bearer ${AUTH.accessToken}`);
    expect(sent.get("x-agent-secret")).toBe(SERVICE_SECRET);
  });

  it("passes the agent's 404 through for someone else's artifact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })),
    );
    const res = await call("abcdefghijkl");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("proxies pdf with attachment disposition", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("%PDF", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="plan.pdf"' } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("abcdefghijkl", "?format=pdf");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="plan.pdf"');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/artifacts\/abcdefghijkl\.pdf$/);
  });

  it("rejects malformed ids without calling the agent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("..%2F..%2Fetc")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies the thumbnail as a private JPEG from the agent's .jpg path", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8]), { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("abcdefghijkl", "?format=thumb");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/artifacts\/abcdefghijkl\.jpg$/);
  });

  it("passes 429 through for a thumbnail and turns other upstream errors into 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "rate_limited", retryAfter: 30 }, { status: 429, headers: { "retry-after": "30" } })),
    );
    const limited = await call("abcdefghijkl", "?format=thumb");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "internal" }, { status: 500 })),
    );
    expect((await call("abcdefghijkl", "?format=thumb")).status).toBe(502);
  });

  it("rejects a bad id for a thumbnail without calling the agent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await call("short", "?format=thumb")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a frame navigation that fails with a static HTML page under the report CSP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })),
    );
    const res = await framed("abcdefghijkl");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-security-policy")).toBe(ARTIFACT_CSP);
    const html = await res.text();
    expect(html).toContain("This report doesn't exist or isn't yours.");
    expect(html).not.toMatch(/<script/i);
  });

  it("names the wait on a rate-limited frame and offers Try again on other failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "rate_limited", retryAfter: 42 }, { status: 429 })),
    );
    const limited = await framed("abcdefghijkl");
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain("Too many requests. Try again in 42 seconds.");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const failed = await framed("abcdefghijkl");
    expect(failed.status).toBe(502);
    const html = await failed.text();
    expect(html).toContain("This report couldn't be loaded.");
    expect(html).toContain('<a id="report-error-retry-link" href="/api/artifacts/abcdefghijkl" target="_self">Try again</a>');
    expect(html).not.toMatch(/<script/i);
  });

  it("keeps JSON errors for requests that are not frame navigations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })),
    );
    const res = await call("abcdefghijkl");
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});
