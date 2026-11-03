import { describe, expect, it } from "vitest";
import { createBff, localAuth } from "../src/index.ts";
import { deps, fakeAgent } from "./support.ts";

const SECRET = "0123456789abcdef".repeat(4);
const TOKEN = "fedcba9876543210".repeat(4);
const ORIGIN = "http://127.0.0.1:18330";
const LOCAL = { appOrigin: [ORIGIN, "http://localhost:18330"], allowedHosts: ["127.0.0.1:18330", "localhost:18330"] };

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: { host: "127.0.0.1:18330", ...init.headers },
    body: init.body,
  });
}

const write = (headers: Record<string, string>) =>
  req("/api/profile", { method: "PUT", body: "{}", headers: { origin: ORIGIN, "content-type": "application/json", ...headers } });

describe("localAuth on its own", () => {
  const auth = localAuth({ secret: SECRET });

  it.each(["cross-site", "same-site", "CROSS-SITE", "garbage"])("refuses Sec-Fetch-Site %s with 403 bad_origin", async (site) => {
    for (const method of ["GET", "POST"]) {
      const outcome = await auth(new Request(`${ORIGIN}/api/chats`, { method, headers: { "sec-fetch-site": site } }));
      expect(outcome).toMatchObject({ ok: false, status: 403, error: "bad_origin" });
    }
  });

  it.each(["same-origin", "none", null])("accepts Sec-Fetch-Site %s and returns only the secret", async (site) => {
    const headers: Record<string, string> = site === null ? {} : { "sec-fetch-site": site };
    const outcome = await auth(new Request(`${ORIGIN}/api/chats`, { headers }));
    expect(outcome).toEqual({ ok: true, headers: { "x-agent-secret": SECRET } });
  });

  it.each(["", "secret", SECRET.toUpperCase(), SECRET.slice(1)])("refuses the secret %j at construction", (secret) => {
    expect(() => localAuth({ secret })).toThrow("64");
  });
});

describe("localAuth through createBff", () => {
  it.each(["cross-site", "same-site"])("refuses Sec-Fetch-Site %s on GET and POST before the agent", async (site) => {
    const agent = fakeAgent();
    const bff = createBff(deps({ ...LOCAL, auth: localAuth({ secret: SECRET }), fetch: agent.fetch }));
    for (const r of [req("/api/chats", { headers: { "sec-fetch-site": site } }), write({ "sec-fetch-site": site })]) {
      const res = await bff(r);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "bad_origin" });
    }
    expect(agent.seen).toEqual([]);
  });

  it("overwrites a forged x-agent-secret with the real one", async () => {
    const agent = fakeAgent();
    const bff = createBff(deps({ ...LOCAL, auth: localAuth({ secret: SECRET }), fetch: agent.fetch }));
    const forged = "1".repeat(64);
    expect((await bff(req("/api/chats", { headers: { "x-agent-secret": forged, "sec-fetch-site": "same-origin" } }))).status).toBe(200);
    expect((await bff(write({ "x-agent-secret": forged, "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect(agent.seen.map((s) => s.headers.get("x-agent-secret"))).toEqual([SECRET, SECRET]);
  });
});

describe("launch-token hook", () => {
  const bffWith = (launchToken?: string) => {
    const agent = fakeAgent();
    return { bff: createBff(deps({ ...LOCAL, auth: localAuth({ secret: SECRET, launchToken }), fetch: agent.fetch })), agent };
  };

  it("is inactive when the token is unset", async () => {
    const { bff, agent } = bffWith(undefined);
    expect((await bff(req("/api/chats"))).status).toBe(200);
    expect((await bff(write({}))).status).toBe(200);
    expect(agent.seen).toHaveLength(2);
  });

  it.each([
    ["no cookie", {}],
    ["a wrong cookie of the same length", { cookie: `oa_launch=${"0".repeat(64)}` }],
    ["the token in another case", { cookie: `oa_launch=${TOKEN.toUpperCase()}` }],
    ["the token under another cookie name", { cookie: `oa_launcher=${TOKEN}` }],
    ["the token as a header", { "x-oa-launch": TOKEN, authorization: `Bearer ${TOKEN}` }],
    ["the token with a suffix", { cookie: `oa_launch=${TOKEN}0` }],
  ])("refuses %s with 401 launch_required", async (_label, headers: Record<string, string>) => {
    const { bff, agent } = bffWith(TOKEN);
    for (const r of [req("/api/chats", { headers }), write(headers), req("/api/artifacts/abcdefghijkl", { headers })]) {
      const res = await bff(r);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: "launch_required" });
    }
    expect(agent.seen).toEqual([]);
  });

  it("refuses the token in a query string", async () => {
    const { bff, agent } = bffWith(TOKEN);
    const res = await bff(req(`/api/chats?oa_launch=${TOKEN}`));
    expect(res.status).toBe(401);
    expect(agent.seen).toEqual([]);
  });

  it.each([`oa_launch=${TOKEN}`, `theme=dark; oa_launch=${TOKEN}`, `oa_launch=${TOKEN}; other=1`])(
    "accepts the cookie %s",
    async (cookie) => {
      const { bff, agent } = bffWith(TOKEN);
      expect((await bff(req("/api/chats", { headers: { cookie } }))).status).toBe(200);
      expect((await bff(write({ cookie, "sec-fetch-site": "same-origin" }))).status).toBe(200);
      expect(agent.seen.map((s) => [...s.headers.keys()].includes("cookie"))).toEqual([false, false]);
    },
  );

  it("still refuses a cross-site request that carries the cookie", async () => {
    const { bff } = bffWith(TOKEN);
    const res = await bff(req("/api/chats", { headers: { cookie: `oa_launch=${TOKEN}`, "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
  });

  it.each(["", "abc", TOKEN.slice(1), `${TOKEN}0`, TOKEN.toUpperCase(), `${TOKEN.slice(0, 63)}z`])(
    "refuses the launch token %j at construction",
    (launchToken) => {
      expect(() => localAuth({ secret: SECRET, launchToken })).toThrow("64");
    },
  );
});
