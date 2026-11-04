import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createAdminGuard } from "../src/identity/adminGuard.js";
import { createGuards } from "@oab/core/identity/guards.js";
import { type AuthEnv, type AuthOutcome, type Identity, NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import { ALL_CAPABILITIES } from "./fixtures/users.js";
import { UserError } from "@oab/core/lib/errors.js";

const ADMIN: Principal = { id: "33333333-3333-4333-8333-333333333333", email: "admin@example.test", capabilities: ALL_CAPABILITIES };
const USER: Principal = { id: "11111111-1111-4111-8111-111111111111", email: "alice@example.test", capabilities: NO_CAPABILITIES };

function harness(outcome: AuthOutcome, isLiveAdmin: (p: Principal) => Promise<boolean> = async () => true) {
  const authenticate = vi.fn(async () => outcome);
  const identity: Identity = { kind: "hosted", admitCaller: () => undefined, authenticate };
  const live = vi.fn(isLiveAdmin);
  const handler = vi.fn();
  const app = new Hono<AuthEnv>();
  app.use("/admin/*", createGuards(identity).requireUser, createAdminGuard({ isLiveAdmin: live }));
  app.get("/admin/users", (c) => {
    handler(c.get("user"));
    return c.json({ ok: true });
  });
  return { call: () => app.request("/admin/users"), live, handler, authenticate };
}

describe("createAdminGuard behind the core requireUser", () => {
  it("lets a live admin through with the principal on the context", async () => {
    const { call, live, handler } = harness({ ok: true, principal: ADMIN });
    expect((await call()).status).toBe(200);
    expect(live).toHaveBeenCalledWith(ADMIN);
    expect(handler).toHaveBeenCalledWith(ADMIN);
  });

  it("answers 404 without a live check when the token doesn't claim admin", async () => {
    const { call, live, handler } = harness({ ok: true, principal: USER });
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Not found." });
    expect(live).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 404 when the live check says no", async () => {
    const { call, handler } = harness({ ok: true, principal: ADMIN }, async () => false);
    expect((await call()).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 503 auth_unavailable when the live check throws", async () => {
    const { call, handler } = harness({ ok: true, principal: ADMIN }, async () => Promise.reject(new Error("auth down")));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "auth_unavailable" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders the authentication error verbatim", async () => {
    const error = new UserError("You were signed out. Sign in again.", "unauthorized", { code: "signed_out" });
    const { call, live } = harness({ ok: false, error });
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed_out", message: "You were signed out. Sign in again." });
    expect(live).not.toHaveBeenCalled();
  });

  it("never authenticates on its own", async () => {
    const { call, authenticate } = harness({ ok: true, principal: ADMIN });
    expect((await call()).status).toBe(200);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("answers 404 when no principal reached it", async () => {
    const live = vi.fn(async () => true);
    const app = new Hono<AuthEnv>();
    app.get("/admin/users", createAdminGuard({ isLiveAdmin: live }), (c) => c.json({ ok: true }));
    const res = await app.request("/admin/users");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Not found." });
    expect(live).not.toHaveBeenCalled();
  });
});
