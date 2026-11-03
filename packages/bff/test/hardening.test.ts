import { describe, expect, it } from "vitest";
import { BffConfigError, createBff } from "../src/index.ts";
import { AGENT, APP, AUTH_HEADERS, CHAT, deps, fakeAgent, request } from "./support.ts";

const redirect = (status: number) => () => new Response("moved", { status, headers: { location: "https://evil.test/x" } });

describe("createBff configuration", () => {
  it.each([
    "ftp://agent.test:8000",
    "http://user:pw@agent.test:8000",
    "http://user@agent.test:8000",
    "http://agent.test:8000?x=1",
    "http://agent.test:8000/?",
    "http://agent.test:8000#frag",
    "http://agent.test:8000/",
    "http://agent.test:8000/base/",
    "agent.test:8000",
    "not a url",
    "",
  ])("refuses agentUrl %j", (agentUrl) => {
    expect(() => createBff(deps({ agentUrl }))).toThrow(BffConfigError);
  });

  it.each(["http://agent.test:8000", "https://agent.example", "http://127.0.0.1:8000/base"])("accepts agentUrl %s", (agentUrl) => {
    expect(() => createBff(deps({ agentUrl }))).not.toThrow();
  });

  it.each(["api", "/api/", "", "/", "//api", "/a pi"])("refuses basePath %j", (basePath) => {
    expect(() => createBff(deps({ basePath }))).toThrow(BffConfigError);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses timeoutMs and maxBodyBytes of %s", (n) => {
    expect(() => createBff(deps({ timeoutMs: n }))).toThrow(BffConfigError);
    expect(() => createBff(deps({ maxBodyBytes: n }))).toThrow(BffConfigError);
  });
});

describe("exact basePath", () => {
  it("handles /api and /api/… but never /apifoo", async () => {
    const agent = fakeAgent();
    const bff = createBff(deps({ fetch: agent.fetch }));
    expect((await bff(request("/api/models"))).status).toBe(200);
    const foo = await bff(request("/apifoo/models"));
    expect(foo.status).toBe(404);
    expect(await foo.json()).toMatchObject({ error: "not_found" });
    expect((await bff(request("/api"))).status).toBe(404);
    expect((await bff(request("/apimodels"))).status).toBe(404);
    expect(agent.seen.map((s) => s.url)).toEqual([`${AGENT}/models`]);
  });

  it("serves another basePath exactly", async () => {
    const agent = fakeAgent();
    const bff = createBff(deps({ fetch: agent.fetch, basePath: "/v1/api" }));
    expect((await bff(request("/v1/api/models"))).status).toBe(200);
    expect((await bff(request("/api/models"))).status).toBe(404);
    expect((await bff(request("/v1/apix/models"))).status).toBe(404);
    expect(agent.seen).toHaveLength(1);
  });
});

describe("auth headers are set last", () => {
  const forged = { "x-agent-secret": "browser-secret", authorization: "Bearer browser-token", cookie: "sb=1", "x-user-id": "evil" };

  it.each([
    ["a forward route", "/api/profile", "PUT", '{"a":1}'],
    ["the artifact route", "/api/artifacts/AbCdEf_-1234", "GET", undefined],
    ["the copilot proxy", "/api/copilotkit/agent/openagent/run", "POST", JSON.stringify({ threadId: CHAT })],
  ])("%s never forwards the browser's credentials", async (_label, path, method, body) => {
    const agent = fakeAgent(() => new Response("{}", { headers: { "content-type": "application/json" } }));
    const bff = createBff(deps({ fetch: agent.fetch }));
    const res = await bff(request(path, { method, body, origin: APP, headers: { ...forged, "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    const sent = agent.seen[0].headers;
    expect(sent.get("x-agent-secret")).toBe(AUTH_HEADERS["x-agent-secret"]);
    expect(sent.get("authorization")).toBe(AUTH_HEADERS.authorization);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("x-user-id")).toBeNull();
  });

  it("auth headers win over a forwarded content-type of the same name", async () => {
    const agent = fakeAgent();
    const bff = createBff(
      deps({ fetch: agent.fetch, auth: async () => ({ ok: true, headers: { ...AUTH_HEADERS, "content-type": "application/x-auth" } }) }),
    );
    await bff(request("/api/profile", { method: "PUT", body: "{}", origin: APP, headers: { "content-type": "application/json" } }));
    expect(agent.seen[0].headers.get("content-type")).toBe("application/x-auth");
  });
});

describe("redirects from the agent", () => {
  it.each([301, 302, 303, 307, 308])(
    "%i is a 502 on a forward route, the artifact route and the copilot proxy, never followed",
    async (status) => {
      for (const [path, method, body] of [
        ["/api/models", "GET", undefined],
        ["/api/artifacts/AbCdEf_-1234", "GET", undefined],
        ["/api/copilotkit/agent/openagent/run", "POST", JSON.stringify({ threadId: CHAT })],
        ["/api/copilotkit/info", "GET", undefined],
      ] as const) {
        const agent = fakeAgent(redirect(status));
        const res = await createBff(deps({ fetch: agent.fetch }))(request(path, { method, body, origin: APP }));
        expect(res.status, path).toBe(502);
        expect(await res.json()).toMatchObject({ error: "agent_unreachable" });
        expect(agent.seen).toHaveLength(1);
        expect(agent.seen[0].redirect).toBe("manual");
      }
    },
  );

  it("treats an opaque redirect as a 502", async () => {
    const opaque = Object.assign(new Response(null, { status: 200 }), {});
    Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
    const agent = fakeAgent(() => opaque);
    expect((await createBff(deps({ fetch: agent.fetch }))(request("/api/models"))).status).toBe(502);
  });
});

describe("upstream URLs come from the route table only", () => {
  it.each([
    "/api/chats/..%2F..%2Fadmin",
    "/api/chats/%2e%2e%2fadmin",
    "/api/providers/%2e%2e/admin",
    "/api/providers/openai%2F..%2F..%2Fadmin",
    "/api/providers/..%2Fadmin",
    "/api/settings/brave-search%2F..%2F..%2Fadmin",
    "/api/reports/..%2F..%2Fadmin",
    "/api/artifacts/..%2F..%2Fadmin",
    "/api/copilotkit/agent/openagent/stop/..%2F..%2Finfo",
    "/api/copilotkit/..%2Fadmin",
    "/api/admin/users",
  ])("%s never reaches the agent outside its route's prefix", async (path) => {
    const agent = fakeAgent();
    const bff = createBff(deps({ fetch: agent.fetch }));
    for (const method of ["GET", "POST"]) await bff(request(path, { method, origin: APP, body: method === "POST" ? "{}" : undefined }));
    expect(agent.seen).toEqual([]);
  });

  it("re-encodes validated values instead of copying the request path", async () => {
    const agent = fakeAgent();
    const bff = createBff(deps({ fetch: agent.fetch }));
    await bff(request(`/api/chats/%41${CHAT.slice(1).toUpperCase()}/messages`));
    await bff(request("/api/providers/openai%2Fkey"));
    await bff(request("/api/search?q=a%2F..%2Fb%23c&scope=chats&evil=1"));
    expect(agent.seen.map((s) => s.url.slice(AGENT.length))).toEqual([
      `/chats/${CHAT}/messages`,
      "/providers/openai/key",
      "/search?q=a%2F..%2Fb%23c&scope=chats&page=1",
    ]);
  });

  it("drops the query string on the copilot proxy", async () => {
    const agent = fakeAgent();
    const bff = createBff(deps({ fetch: agent.fetch }));
    await bff(request("/api/copilotkit/info?agentId=openagent&url=http://evil.test"));
    expect(agent.seen.map((s) => s.url)).toEqual([`${AGENT}/copilotkit/info`]);
  });
});

describe("copilot proxy response headers", () => {
  it("copies only content-type and sets private, no-store", async () => {
    const agent = fakeAgent(
      () =>
        new Response("data: {}\n\n", {
          headers: {
            "content-type": "text/event-stream",
            "set-cookie": "a=1",
            "x-foo": "1",
            "cache-control": "public",
            "access-control-allow-origin": "*",
          },
        }),
    );
    const res = await createBff(deps({ fetch: agent.fetch }))(
      request("/api/copilotkit/agent/openagent/run", { method: "POST", origin: APP, body: JSON.stringify({ threadId: CHAT }) }),
    );
    expect([...res.headers.keys()].sort()).toEqual(["cache-control", "content-type"]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });
});

describe("methods", () => {
  it("answers 405 for a known path with another method, before auth", async () => {
    const agent = fakeAgent();
    let authCalls = 0;
    const bff = createBff(
      deps({
        fetch: agent.fetch,
        auth: async () => {
          authCalls += 1;
          return { ok: true, headers: AUTH_HEADERS };
        },
      }),
    );
    for (const [path, method] of [
      ["/api/chats", "POST"],
      ["/api/models", "OPTIONS"],
      ["/api/profile", "DELETE"],
      ["/api/settings/brave-search", "PUT"],
    ]) {
      const res = await bff(request(path, { method, origin: APP }));
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(await res.json()).toMatchObject({ error: "method_not_allowed" });
    }
    expect(authCalls).toBe(0);
    expect(agent.seen).toEqual([]);
  });

  it("serves HEAD wherever GET is served, as Next does", async () => {
    const agent = fakeAgent();
    const res = await createBff(deps({ fetch: agent.fetch }))(request("/api/models", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect(agent.seen.map((s) => s.method)).toEqual(["HEAD"]);
  });
});

describe("limits", () => {
  it("applies maxBodyBytes to forwarded bodies", async () => {
    const agent = fakeAgent();
    const bff = createBff(deps({ fetch: agent.fetch, maxBodyBytes: 10 }));
    expect((await bff(request("/api/profile", { method: "PUT", origin: APP, body: "x".repeat(10) }))).status).toBe(200);
    const res = await bff(request("/api/profile", { method: "PUT", origin: APP, body: "x".repeat(11) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_large" });
    expect(agent.seen).toHaveLength(1);
  });

  it("times out a forward after timeoutMs", async () => {
    const agent = fakeAgent(
      (seen) =>
        new Promise<Response>((_resolve, reject) => {
          seen.signal?.addEventListener("abort", () => reject(seen.signal?.reason));
        }),
    );
    const res = await createBff(deps({ fetch: agent.fetch, timeoutMs: 20 }))(request("/api/models"));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "agent_unreachable" });
  });

  it("does not cap the copilot request body; the agent's own run cap applies", async () => {
    const agent = fakeAgent();
    const big = JSON.stringify({ threadId: CHAT, pad: "x".repeat(2 * 1024 * 1024) });
    const res = await createBff(deps({ fetch: agent.fetch }))(
      request("/api/copilotkit/agent/openagent/run", { method: "POST", origin: APP, body: big }),
    );
    expect(res.status).toBe(200);
    expect(agent.seen[0].body).toBe(big);
  });
});

describe("normalized paths", () => {
  it.each([
    ["/api/", "/api"],
    ["/api/models/", "/api/models"],
    ["/api/chats//x", "/api/chats/x"],
    ["/api//models?x=1", "/api/models?x=1"],
  ])("%s redirects 308 to %s without calling the agent", async (path, location) => {
    const agent = fakeAgent();
    const res = await createBff(deps({ fetch: agent.fetch }))(request(path));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(location);
    expect(agent.seen).toEqual([]);
  });

  it("answers malformed percent-encoding as Next does, without calling the agent", async () => {
    const agent = fakeAgent();
    const res = await createBff(deps({ fetch: agent.fetch }))(request(`/api/chats/${CHAT}%E0%A4%A`));
    expect(res.status).toBe(500);
    expect(agent.seen).toEqual([]);
  });
});
