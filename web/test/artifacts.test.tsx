import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/artifacts/[id]/route";
import { ArtifactCard, parseArtifactId } from "@/components/artifacts/ArtifactCard";
import { AUTH, headersOf, SERVICE_SECRET, stubAgentEnv } from "./support/agentEnv";

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

describe("artifacts route", () => {
  it("artifacts route forces sandbox CSP", async () => {
    const fetchMock = vi.fn(async () => new Response("<h1>x</h1>", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("abcdefghijkl");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox");
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
});

describe("ArtifactCard", () => {
  it("parses id from tool result", () => {
    expect(parseArtifactId("artifact abcdefghijkl created: Plan")).toBe("abcdefghijkl");
    expect(parseArtifactId("html too large")).toBeNull();
  });

  it("shows the report inline in a sandboxed, scrollable frame with new tab, full screen and PDF", () => {
    render(<ArtifactCard toolCallId="a1" title="Diwali plan" result="artifact abcdefghijkl created: Diwali plan" />);
    const inline = screen.getByTitle("Diwali plan");
    expect(inline.tagName).toBe("IFRAME");
    expect(inline).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    expect(inline).toHaveAttribute("src", "/api/artifacts/abcdefghijkl");
    expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("href", "/api/artifacts/abcdefghijkl");
    expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/artifacts/abcdefghijkl?format=pdf");
    fireEvent.click(screen.getByRole("button", { name: "Open full screen" }));
    expect(screen.getByRole("dialog", { name: "Diwali plan" })).toBeInTheDocument();
    expect(screen.getAllByTitle("Diwali plan")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTitle("Diwali plan")).toHaveLength(1);
  });
});
