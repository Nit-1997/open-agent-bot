import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestLine, requestLog } from "../../src/local/requestLog.js";

const SECRET = "0123456789abcdef".repeat(4);
const UUID = "0b7c3f5e-3a52-4f8b-9a6e-8f1c2d3e4f50";
const LINE = /^\[http\] [A-Z]+ \S+ \d{3} \d+ms$/;

function app() {
  const lines: string[] = [];
  const hono = new Hono();
  hono.use(requestLog((line) => lines.push(line)));
  hono.get("/api/search", (c) => c.json({ items: [] }));
  hono.get("/api/chats/:id", (c) => c.json({ id: c.req.param("id") }));
  hono.get("/reports/:id", (c) => c.text("page"));
  hono.post("/api/copilotkit/agent/openagent/run", () => {
    let n = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        n += 1;
        if (n > 3) return controller.close();
        await new Promise((r) => setTimeout(r, 20));
        controller.enqueue(new TextEncoder().encode(`data: ${n}\n\n`));
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  });
  hono.all("*", (c) => c.text("nope", 404));
  return { hono, lines };
}

describe("request log", () => {
  it("logs method, path, status and time with no query, header or secret", async () => {
    const { hono, lines } = app();
    const res = await hono.request("http://127.0.0.1:18330/api/search?q=secret-word&scope=chats", {
      headers: { "x-agent-secret": SECRET, cookie: `oa_launch=${SECRET}` },
    });
    expect(res.status).toBe(200);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[http\] GET \/api\/search 200 \d+ms$/);
    const all = lines.join("\n");
    for (const banned of ["secret-word", "scope", "?", SECRET, "x-agent-secret", "cookie", "oa_launch"]) expect(all).not.toContain(banned);
  });

  it("replaces UUID and report-id segments with :id", async () => {
    const { hono, lines } = app();
    await hono.request(`http://127.0.0.1:18330/api/chats/${UUID}`);
    await hono.request(`http://127.0.0.1:18330/api/chats/${UUID.toUpperCase()}`);
    await hono.request("http://127.0.0.1:18330/reports/AbCdEf_12-34");
    expect(lines.map((l) => l.replace(/\d+ms$/, "Nms"))).toEqual([
      "[http] GET /api/chats/:id 200 Nms",
      "[http] GET /api/chats/:id 200 Nms",
      "[http] GET /reports/:id 200 Nms",
    ]);
  });

  it("writes one line for a stream when its headers go out, none at stream close", async () => {
    const { hono, lines } = app();
    const res = await hono.request("http://127.0.0.1:18330/api/copilotkit/agent/openagent/run", { method: "POST" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[http\] POST \/api\/copilotkit\/agent\/openagent\/run 200 \d+ms$/);
    expect(await res.text()).toContain("data: 3");
    expect(lines).toHaveLength(1);
  });

  it("logs refused and missing paths too", async () => {
    const { hono, lines } = app();
    await hono.request("http://127.0.0.1:18330/nope/deeper");
    expect(lines[0]).toMatch(/^\[http\] GET \/nope\/deeper 404 \d+ms$/);
  });
});

describe("requestLine", () => {
  it("escapes control characters in the path", () => {
    const line = requestLine("GET", "/a\r\nforged [http] GET / 200 1ms", 404, 3);
    expect(line).not.toMatch(/[\r\n]/);
    expect(line).toContain("\\u000d\\u000a");
    expect(line.split("\n")).toHaveLength(1);
  });

  it("drops any query string and fragment it is handed", () => {
    expect(requestLine("GET", "/api/search?q=hidden#frag", 200, 1)).toBe("[http] GET /api/search 200 1ms");
  });

  it("cuts the line to 200 characters", () => {
    const line = requestLine("GET", `/${"a".repeat(500)}`, 404, 1);
    expect(line.length).toBeLessThanOrEqual(200);
    expect(line.startsWith("[http] GET /aaaa")).toBe(true);
  });

  it("rounds the time to whole milliseconds", () => {
    expect(requestLine("POST", "/api/profile", 403, 12.7)).toBe("[http] POST /api/profile 403 13ms");
    expect(requestLine("POST", "/api/profile", 403, 12.7)).toMatch(LINE);
  });

  it("keeps short words and non-id segments", () => {
    expect(requestLine("GET", "/api/providers/openrouter/models", 200, 1)).toBe("[http] GET /api/providers/openrouter/models 200 1ms");
    expect(requestLine("GET", "/assets/index-CkL3x9aZ.js", 200, 1)).toBe("[http] GET /assets/index-CkL3x9aZ.js 200 1ms");
  });
});
