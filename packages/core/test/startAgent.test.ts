import { Server } from "node:http";
import { createServer } from "node:net";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserPool } from "../src/browser/pool.js";
import { parseCredentialKeys } from "../src/config.js";
import { LocalKeyWrapper } from "../src/crypto/keyWrapper.js";
import { createAdminGuard } from "../src/hosted/identity/adminGuard.js";
import { hostedRoutes } from "../src/hosted/routes.js";
import type { AuthEnv, Identity, RouteMount } from "../src/identity/types.js";
import { SessionStore } from "../src/session/sessionStore.js";
import { type AgentDeps, type RunningAgent, startAgent } from "../src/startAgent.js";
import type { Store } from "../src/store/types.js";
import { FakeAccounts } from "./fixtures/app.js";
import { TEST_KEY_B64, testConfig } from "./fixtures/config.js";
import { MemoryDb } from "./fixtures/memoryRepos.js";
import { ALICE } from "./fixtures/users.js";
import { createAccessService } from "../src/hosted/access/service.js";
import { createAdminService } from "../src/hosted/admin/service.js";
import { BackgroundQueue } from "../src/lib/backgroundQueue.js";
import { RateLimiter } from "../src/lib/rateLimit.js";

const localIdentity: Identity = {
  kind: "local",
  admitCaller: () => undefined,
  authenticate: async () => ({ ok: true, principal: ALICE }),
};

const running: RunningAgent[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(running.splice(0).map((a) => a.close()));
});

function coreDeps(over: Partial<AgentDeps> = {}): AgentDeps {
  return {
    config: testConfig({ LOG_LEVEL: "error" }),
    store: new MemoryDb(),
    identity: localIdentity,
    keyWrapper: new LocalKeyWrapper(parseCredentialKeys(`v1:${TEST_KEY_B64}`)),
    port: 0,
    ...over,
  };
}

async function start(over: Partial<AgentDeps> = {}) {
  const agent = await startAgent(coreDeps(over));
  running.push(agent);
  return agent;
}

const portFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

function hostedMounts(limiter = new RateLimiter()): RouteMount[] {
  const accounts = new FakeAccounts();
  return hostedRoutes({
    access: createAccessService({
      pepper: Buffer.alloc(32, 9),
      limiter,
      queue: new BackgroundQueue({ name: "access", max: 5, concurrency: 1 }),
      submit: async () => "inserted",
      sendMagicLink: async () => ({}),
    }),
    admin: createAdminService({
      repo: accounts.repo(),
      auth: accounts.auth(),
      hooks: { onDisabled: async () => {}, onEnabled: () => {} },
    }),
    adminGuard: createAdminGuard({ isLiveAdmin: async () => true }),
    limiter,
  });
}

const mountWith = (stage: RouteMount["stage"], basePath: string, register: (app: Hono<AuthEnv>) => void): RouteMount => {
  const routes = new Hono<AuthEnv>();
  register(routes);
  return { stage, basePath, routes };
};

const ok = (app: Hono<AuthEnv>, path: string) => app.get(path, (c) => c.json({ ok: true }));

describe("startAgent", () => {
  it("listens on 127.0.0.1 by default and answers /health", async () => {
    const agent = await start();
    expect(agent.host).toBe("127.0.0.1");
    expect(agent.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${agent.port}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("listens on the host it is given", async () => {
    const agent = await start({ host: "0.0.0.0" });
    expect(agent.host).toBe("0.0.0.0");
    expect((await fetch(`http://127.0.0.1:${agent.port}/health`)).status).toBe(200);
  });

  it("serves no admin or access routes without mounts", async () => {
    const agent = await start();
    for (const [method, path] of [
      ["GET", "/admin/users"],
      ["POST", "/access-requests"],
      ["POST", "/auth/email-link"],
    ]) {
      const res = await agent.app.request(path, {
        method,
        headers: { authorization: "Bearer t" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found", message: "Not found." });
    }
    expect((await agent.app.request("/chats")).status).toBe(200);
  });

  it("frees the port on close and shuts down in order with store.close last", async () => {
    const order: string[] = [];
    const serverClose = Server.prototype.close;
    vi.spyOn(Server.prototype, "close").mockImplementation(function (this: Server, cb?: (err?: Error) => void) {
      order.push("server.close");
      return serverClose.call(this, cb);
    });
    vi.spyOn(SessionStore.prototype, "disposeAll").mockImplementation(async () => {
      order.push("sessions.disposeAll");
    });
    vi.spyOn(BrowserPool.prototype, "closeAll").mockImplementation(async () => {
      order.push("pool.closeAll");
    });
    const store: Store = Object.assign(new MemoryDb(), { close: vi.fn(async () => void order.push("store.close")) });
    const agent = await startAgent(coreDeps({ store }));
    expect(await portFree(agent.port)).toBe(false);
    await agent.close();
    await agent.close();
    expect(order).toEqual(["server.close", "sessions.disposeAll", "pool.closeAll", "store.close"]);
    expect(await portFree(agent.port)).toBe(true);
  });

  it("starts with the hosted mounts", async () => {
    const agent = await start({ routes: () => hostedMounts() });
    const link = await agent.app.request("/auth/email-link", { method: "POST", body: JSON.stringify({ email: "a@example.test" }) });
    expect(link.status).toBe(202);
    expect((await agent.app.request("/admin/users")).status).toBe(404);
  });
});

describe("startAgent mount refusals", () => {
  const refuse = async (mount: RouteMount, message: string) => {
    const listen = vi.spyOn(Server.prototype, "listen");
    await expect(start({ routes: () => [mount] })).rejects.toThrow(new Error(message));
    expect(listen).not.toHaveBeenCalled();
  };

  it.each([
    ["/chats/x", "GET /chats/x"],
    ["/providers", "GET /providers"],
    ["*", "GET /*"],
    ["/*", "GET /*"],
    ["/:id", "GET /:id"],
  ])("refuses a public route on %s", async (path, route) => {
    await refuse(
      mountWith("public", "/", (app) => ok(app, path)),
      `public mount route ${route} overlaps a user path`,
    );
  });

  it("refuses public middleware on every path", async () => {
    await refuse(
      mountWith("public", "/", (app) => app.use("*", async (_c, next) => next())),
      "public mount route ALL /* overlaps a user path",
    );
  });

  it.each(["/", "admin", "/Admin", "/admin/", ""])("refuses the protected basePath %j", async (basePath) => {
    await refuse(
      mountWith("protected", basePath, (app) => ok(app, "/admin/x")),
      `protected mount basePath "${basePath}" must be a non-root absolute path`,
    );
  });

  it.each([
    ["/adminx", "GET /adminx", (app: Hono<AuthEnv>) => ok(app, "/adminx")],
    ["/other", "GET /other", (app: Hono<AuthEnv>) => ok(app, "/other")],
    ["/*", "GET /*", (app: Hono<AuthEnv>) => ok(app, "/*")],
    ["use(*)", "ALL /*", (app: Hono<AuthEnv>) => app.use("*", async (_c, next) => next())],
  ])("refuses a protected route outside basePath: %s", async (_name, route, register) => {
    await refuse(mountWith("protected", "/admin", register), `protected mount route ${route} lies outside basePath /admin`);
  });

  it("accepts public routes that miss every user path and protected routes under basePath", async () => {
    const agent = await start({
      routes: () => [
        mountWith("public", "/", (app) => ok(app, "/access-requests")),
        mountWith("protected", "/admin", (app) => {
          ok(app, "/admin");
          ok(app, "/admin/users/:id");
        }),
      ],
    });
    expect((await agent.app.request("/access-requests")).status).toBe(200);
  });
});
