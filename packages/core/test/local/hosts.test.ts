import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { hostGuard, localHosts, localOrigins } from "../../src/local/hosts.js";

const P = 18330;

function front() {
  const app = new Hono();
  app.use(hostGuard(P));
  app.get("/health", (c) => c.json({ ok: true }));
  app.all("/api/*", (c) => c.json({ reached: "api" }));
  app.all("*", (c) => c.text("page"));
  return app;
}

const send = (path: string, host: string | null, method = "GET") => {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  return front().request(`http://front${path}`, { method, headers });
};

describe("localHosts and localOrigins", () => {
  it("derive the allowlist from the published port only", () => {
    expect(localHosts(P)).toEqual(["127.0.0.1:18330", "localhost:18330"]);
    expect(localOrigins(P)).toEqual(["http://127.0.0.1:18330", "http://localhost:18330"]);
  });

  it.each([0, -1, 65536, 1.5, Number.NaN])("refuse the port %s", (port) => {
    expect(() => localHosts(port)).toThrow();
    expect(() => localOrigins(port)).toThrow();
    expect(() => hostGuard(port)).toThrow();
  });
});

describe("hostGuard", () => {
  it.each(["127.0.0.1:18330", "localhost:18330", "LOCALHOST:18330", "LocalHost:18330"])("allows %s", async (host) => {
    expect((await send("/api/chats", host)).status).toBe(200);
    expect(await (await send("/", host)).text()).toBe("page");
  });

  const refused = [
    "evil.example",
    "evil.example:18330",
    "127.0.0.1:3000",
    "127.0.0.1",
    "localhost",
    "[::1]:18330",
    "0.0.0.0:18330",
    "127.0.0.1.nip.io:18330",
    "127.0.0.1:18330.evil.example",
    "",
  ];

  it.each(refused)("refuses Host %j on /api with JSON 421", async (host) => {
    const res = await send("/api/chats", host);
    expect(res.status).toBe(421);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await res.json()).toMatchObject({ error: "misdirected" });
  });

  it.each(refused)("refuses Host %j on pages with text 421", async (host) => {
    const res = await send("/", host);
    expect(res.status).toBe(421);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).not.toBe("page");
  });

  it("refuses a missing Host", async () => {
    expect((await send("/api/chats", null)).status).toBe(421);
    expect((await send("/", null)).status).toBe(421);
  });

  it.each(["evil.example", "127.0.0.1:3000", "", null])("exempts GET /health for Host %j", async (host) => {
    const res = await send("/health", host);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("exempts only GET /health", async () => {
    expect((await send("/health", "evil.example", "POST")).status).toBe(421);
    expect((await send("/health/x", "evil.example")).status).toBe(421);
    expect((await send("/healthz", "evil.example")).status).toBe(421);
    expect((await send("/api/health", "evil.example")).status).toBe(421);
  });
});
