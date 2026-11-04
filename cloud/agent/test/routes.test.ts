import { describe, expect, it, vi } from "vitest";
import { createAccessService } from "../src/access/service.js";
import { createAdminService } from "../src/admin/service.js";
import { createAdminGuard } from "../src/identity/adminGuard.js";
import { hostedRoutes } from "../src/routes.js";
import { BackgroundQueue } from "@oab/core/lib/backgroundQueue.js";
import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { checkMounts } from "@oab/core/startAgent.js";
import { FakeAccounts, makeHostedApp } from "./fixtures/hostedApp.js";
import { TEST_SECRET } from "./fixtures/config.js";
import { ADMIN, ALICE } from "./fixtures/users.js";

function mounts() {
  const accounts = new FakeAccounts();
  const limiter = new RateLimiter();
  const adminGuard = createAdminGuard({ isLiveAdmin: async () => true });
  const list = hostedRoutes({
    access: createAccessService({
      pepper: Buffer.alloc(32, 9),
      limiter,
      queue: new BackgroundQueue({ name: "access", max: 5, concurrency: 1 }),
      submit: async () => "inserted",
      sendMagicLink: async () => ({}),
    }),
    admin: createAdminService({ repo: accounts.repo(), auth: accounts.auth(), hooks: { onDisabled: async () => {}, onEnabled: () => {} } }),
    adminGuard,
    limiter,
  });
  return { list, adminGuard };
}

describe("hostedRoutes", () => {
  it("mounts access as public at / and admin as protected at /admin, and passes the mount checks", () => {
    const { list } = mounts();
    expect(list.map((m) => [m.stage, m.basePath])).toEqual([
      ["public", "/"],
      ["protected", "/admin"],
    ]);
    expect(() => checkMounts(list)).not.toThrow();
  });

  it("registers the admin guard on /admin and /admin/* before the admin routes", () => {
    const { list, adminGuard } = mounts();
    const routes = list[1]!.routes.routes;
    const guarded = routes.filter((r) => r.handler === adminGuard).map((r) => [r.method, r.path]);
    expect(guarded).toEqual([
      ["ALL", "/admin"],
      ["ALL", "/admin/*"],
    ]);
    const firstRoute = routes.findIndex((r) => r.method !== "ALL");
    expect(routes.findLastIndex((r) => r.handler === adminGuard)).toBeLessThan(firstRoute);
    expect(list[0]!.routes.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["POST /access-requests", "POST /auth/email-link"]);
  });

  it("hides admin routes from a non-admin and lets the admin list users and requests", async () => {
    const { call } = await makeHostedApp();
    expect((await call(ALICE, "/admin/users")).status).toBe(404);
    expect((await call(ADMIN, "/admin/users")).status).toBe(200);
    expect((await call(ADMIN, "/admin/access-requests")).status).toBe(200);
  });

  it.each(["/admin/nope", "/admin", "/admin/"])("answers 401 signed_out on %s without a bearer", async (path) => {
    const { call } = await makeHostedApp();
    const res = await call(null, path);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "signed_out" });
  });

  it("never authenticates inside the admin guard", async () => {
    const h = await makeHostedApp();
    const spy = vi.spyOn(h.identity, "authenticate");
    expect((await h.call(ADMIN, "/admin/users")).status).toBe(200);
    expect((await h.call(ALICE, "/admin/users")).status).toBe(404);
    const perRequest = spy.mock.calls.length / 2;
    expect(perRequest).toBe(1);
  });

  it("refuses a wrong service secret before anything else", async () => {
    const { call } = await makeHostedApp();
    expect((await call(ADMIN, "/admin/users", { secret: `${TEST_SECRET.slice(1)}b` })).status).toBe(401);
  });
});
