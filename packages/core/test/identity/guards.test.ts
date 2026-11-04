import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createGuards } from "../../src/identity/guards.js";
import { type AuthEnv, type AuthOutcome, type Identity, NO_CAPABILITIES, type Principal } from "../../src/identity/types.js";
import { UserError } from "../../src/lib/errors.js";

const PRINCIPAL: Principal = { id: "11111111-1111-4111-8111-111111111111", email: "alice@example.test", capabilities: NO_CAPABILITIES };

function harness(opts: { admit?: UserError; outcome?: AuthOutcome } = {}) {
  const identity: Identity = {
    kind: "hosted",
    admitCaller: vi.fn(() => opts.admit),
    authenticate: vi.fn(async () => opts.outcome ?? { ok: true as const, principal: PRINCIPAL }),
  };
  const handler = vi.fn();
  const guards = createGuards(identity);
  const app = new Hono<AuthEnv>();
  app.use("*", guards.requireService);
  app.get("/open", (c) => c.json({ open: true }));
  app.get("/me", guards.requireUser, (c) => {
    handler(c.get("user"));
    return c.json({ id: c.get("user").id });
  });
  return { app, identity, handler };
}

describe("createGuards", () => {
  it("hands the raw request to admitCaller and lets an admitted caller through", async () => {
    const { app, identity } = harness();
    const res = await app.request("/open", { headers: { "x-agent-secret": "s" } });
    expect(res.status).toBe(200);
    const req = vi.mocked(identity.admitCaller).mock.calls[0]![0];
    expect(req).toBeInstanceOf(Request);
    expect(req.headers.get("x-agent-secret")).toBe("s");
    expect(identity.authenticate).not.toHaveBeenCalled();
  });

  it("renders the admitCaller refusal verbatim and never authenticates", async () => {
    const { app, identity, handler } = harness({ admit: new UserError("Unauthorized.", "unauthorized") });
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized", message: "Unauthorized." });
    expect(res.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(identity.authenticate).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("renders any other admitCaller refusal with its own kind and code", async () => {
    const res = await harness({ admit: new UserError("Wrong origin.", "forbidden", { code: "bad_origin" }) }).app.request("/open");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "bad_origin", message: "Wrong origin." });
  });

  it("renders the authenticate error verbatim and never runs the handler", async () => {
    const error = new UserError("Your access has been turned off.", "forbidden", { code: "account_disabled" });
    const { app, handler } = harness({ outcome: { ok: false, error } });
    const res = await app.request("/me");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_disabled", message: "Your access has been turned off." });
    expect(handler).not.toHaveBeenCalled();
  });

  it("puts the authenticated principal on the context", async () => {
    const { app, identity, handler } = harness();
    const res = await app.request("/me", { headers: { authorization: "Bearer x" } });
    expect(await res.json()).toEqual({ id: PRINCIPAL.id });
    expect(handler).toHaveBeenCalledWith(PRINCIPAL);
    expect(handler.mock.calls[0]![0]).toBe(PRINCIPAL);
    expect(vi.mocked(identity.authenticate).mock.calls[0]![0].headers.get("authorization")).toBe("Bearer x");
  });
});
