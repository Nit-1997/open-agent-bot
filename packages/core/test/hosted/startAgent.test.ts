import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessService } from "../../src/hosted/access/service.js";
import { createAdminService } from "../../src/hosted/admin/service.js";
import { createAdminGuard } from "../../src/hosted/identity/adminGuard.js";
import { hostedRoutes } from "../../src/hosted/routes.js";
import type { RouteMount } from "../../src/identity/types.js";
import { BackgroundQueue } from "../../src/lib/backgroundQueue.js";
import { RateLimiter } from "../../src/lib/rateLimit.js";
import { type AgentDeps, type RunningAgent, startAgent } from "../../src/startAgent.js";
import { coreDeps } from "../fixtures/agent.js";
import { FakeAccounts } from "./fixtures/hostedApp.js";

const running: RunningAgent[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(running.splice(0).map((a) => a.close()));
});

async function start(over: Partial<AgentDeps> = {}) {
  const agent = await startAgent(coreDeps(over));
  running.push(agent);
  return agent;
}

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

describe("startAgent", () => {
  it("starts with the hosted mounts", async () => {
    const agent = await start({ routes: () => hostedMounts() });
    const link = await agent.app.request("/auth/email-link", { method: "POST", body: JSON.stringify({ email: "a@example.test" }) });
    expect(link.status).toBe(202);
    expect((await agent.app.request("/admin/users")).status).toBe(404);
  });
});
