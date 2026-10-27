import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/artifacts/[id]/route";
import { ArtifactCard, parseArtifactId } from "@/components/artifacts/ArtifactCard";

afterEach(() => vi.unstubAllGlobals());

const call = (id: string, qs = "") => GET(new Request(`http://localhost/api/artifacts/${id}${qs}`), { params: Promise.resolve({ id }) });

describe("artifacts route", () => {
  it("artifacts route forces sandbox CSP", async () => {
    const fetchMock = vi.fn(async () => new Response("<h1>x</h1>", { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("abcdefghijkl");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/artifacts\/abcdefghijkl$/);
  });

  it("proxies pdf with attachment disposition", async () => {
    const fetchMock = vi.fn(
      async () => new Response("%PDF", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="plan.pdf"' } }),
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

  it("opens a sandboxed viewer and links the pdf", () => {
    render(<ArtifactCard toolCallId="a1" title="Diwali plan" result="artifact abcdefghijkl created: Diwali plan" />);
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/artifacts/abcdefghijkl?format=pdf");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const frame = screen.getByTitle("Diwali plan");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("src", "/api/artifacts/abcdefghijkl");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTitle("Diwali plan")).toBeNull();
  });
});
