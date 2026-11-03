import { Server } from "node:net";
import { createBff, localAuth } from "@oab/bff";
import { LOCAL_USER_ID } from "@oab/shared/local";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalIdentity } from "../../src/identity/localIdentity.js";
import { hostGuard, localHosts, localOrigins } from "../../src/local/hosts.js";
import { parseCredentialKeys } from "../../src/secrets/keys.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";
import { type RunningAgent, startAgent } from "../../src/startAgent.js";
import { TEST_KEY_B64, testConfig } from "../fixtures/config.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { BOB, CHAT_1, CHAT_2 } from "../fixtures/users.js";

const P = 18330;
const SECRET = "0123456789abcdef".repeat(4);
const APP = `http://127.0.0.1:${P}`;

const listeners = () => process.getActiveResourcesInfo().filter((r) => r === "TCPServerWrap").length;

let agent: RunningAgent;
let listenCalls: number;
let listenersBefore: number;
let listenersAfter: number;

async function seeded() {
  const db = new MemoryDb();
  await db.forUser(LOCAL_USER_ID).chats.claim(CHAT_1, {});
  await db.forUser(LOCAL_USER_ID).chats.touch(CHAT_1, { titleIfEmpty: "Local chat" });
  await db.forUser(BOB.id).chats.claim(CHAT_2, {});
  await db.forUser(BOB.id).chats.touch(CHAT_2, { titleIfEmpty: "Someone else" });
  return db;
}

beforeAll(async () => {
  const store = await seeded();
  const listen = vi.spyOn(Server.prototype, "listen");
  listenersBefore = listeners();
  agent = await startAgent({
    config: testConfig({ LOG_LEVEL: "error" }),
    store,
    identity: createLocalIdentity({ secret: SECRET }),
    keyWrapper: new LocalKeyWrapper(parseCredentialKeys(`v1:${TEST_KEY_B64}`)),
    listen: false,
  });
  listenersAfter = listeners();
  listenCalls = listen.mock.calls.length;
  listen.mockRestore();
  return () => agent.close();
});

afterEach(() => vi.restoreAllMocks());

function front() {
  const inProcess = (input: string | URL | Request, init?: RequestInit) => agent.app.fetch(new Request(input, init));
  const bff = createBff({
    agentUrl: "http://127.0.0.1:8000",
    appOrigin: localOrigins(P),
    allowedHosts: localHosts(P),
    auth: localAuth({ secret: SECRET }),
    fetch: inProcess as typeof fetch,
  });
  const app = new Hono();
  app.use(hostGuard(P));
  app.all("/api/*", (c) => bff(c.req.raw));
  app.get("*", (c) => c.text("page"));
  return app;
}

function call(path: string, init: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {}) {
  const headers = new Headers({ host: init.host ?? `127.0.0.1:${P}`, ...init.headers });
  return front().request(`${APP}${path}`, { method: init.method ?? "GET", headers, body: init.body });
}

describe("the local core has no listener", () => {
  it("opens no port with listen: false", () => {
    expect(listenCalls).toBe(0);
    expect(listenersAfter).toBe(listenersBefore);
    expect(agent.port).toBe(0);
    expect(agent.host).toBe("");
  });
});

describe("DNS rebinding", () => {
  it.each(["evil.example", `evil.example:${P}`, "127.0.0.1:3000", `127.0.0.1.nip.io:${P}`])(
    "Host %s → 421 on /api/chats and /",
    async (host) => {
      const api = await call("/api/chats", { host, headers: { "sec-fetch-site": "same-origin" } });
      expect(api.status).toBe(421);
      expect(await api.json()).toMatchObject({ error: "misdirected" });
      const page = await call("/", { host });
      expect(page.status).toBe(421);
      expect(await page.text()).not.toBe("page");
    },
  );
});

describe("other websites", () => {
  const save = (headers: Record<string, string>) =>
    call("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ profile: { name: "Pwned" } }),
    });

  it.each([
    ["a foreign Origin", { origin: "http://evil.example" }],
    ["Origin: null", { origin: "null" }],
    ["no Origin", {}],
    ["Sec-Fetch-Site: cross-site", { origin: APP, "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site: same-site", { origin: APP, "sec-fetch-site": "same-site" }],
  ])("a write with %s → 403 bad_origin and the profile is unchanged", async (_label, headers) => {
    const res = await save(headers);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_origin" });
    const profile = await call("/api/profile", { headers: { "sec-fetch-site": "same-origin" } });
    expect(JSON.stringify(await profile.json())).not.toContain("Pwned");
  });

  it.each(["cross-site", "same-site"])("a read with Sec-Fetch-Site: %s → 403", async (site) => {
    const res = await call("/api/chats", { headers: { "sec-fetch-site": site } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_origin" });
  });

  it.each([`http://localhost:${P}`, APP])("a write with Origin %s reaches the core", async (origin) => {
    const res = await save({ origin, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ profile: { name: "Pwned" } });
  });
});

describe("the core without the bff", () => {
  it.each([
    ["no secret", {}],
    ["an empty secret", { "x-agent-secret": "" }],
    ["a wrong secret", { "x-agent-secret": "fedcba9876543210".repeat(4) }],
  ])("answers 401 with %s", async (_label, headers) => {
    for (const path of ["/chats", "/profile", "/models", "/copilotkit/info"]) {
      const res = await agent.app.fetch(new Request(`http://127.0.0.1:8000${path}`, { headers }));
      expect(res.status, path).toBe(401);
    }
  });

  it("answers with the secret", async () => {
    const res = await agent.app.fetch(new Request("http://127.0.0.1:8000/chats", { headers: { "x-agent-secret": SECRET } }));
    expect(res.status).toBe(200);
  });
});

describe("the same-origin UI", () => {
  it("gets the local user's chats only", async () => {
    const res = await call("/api/chats", { headers: { "sec-fetch-site": "same-origin" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; title: string }> };
    expect(body.items.map((c) => c.id)).toEqual([CHAT_1]);
    expect(body.items[0].title).toBe("Local chat");
  });

  it("works for a browser that sends no Sec-Fetch-Site on reads", async () => {
    expect((await call("/api/chats")).status).toBe(200);
  });

  it("serves no CORS headers on a foreign-origin preflight", async () => {
    const res = await call("/api/chats", {
      method: "OPTIONS",
      headers: { origin: "http://evil.example", "access-control-request-method": "GET" },
    });
    expect([404, 405]).toContain(res.status);
    expect([...res.headers.keys()].filter((k) => k.startsWith("access-control-allow"))).toEqual([]);
  });
});
