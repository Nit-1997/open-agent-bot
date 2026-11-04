import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { UserStatusCache } from "../../../src/hosted/identity/status.js";
import { AuthError } from "../../../src/hosted/identity/verify.js";
import { createAdminGuard } from "../../../src/hosted/identity/adminGuard.js";
import { createSupabaseIdentity, serviceSecretMatches } from "../../../src/hosted/identity/supabaseIdentity.js";
import { createGuards } from "../../../src/identity/guards.js";
import type { AuthEnv } from "../../../src/identity/types.js";
import { TEST_SECRET } from "../fixtures/config.js";
import { ADMIN, ALICE, verified } from "../fixtures/users.js";

function app(
  opts: {
    verify?: (t: string) => Promise<typeof ALICE>;
    status?: () => Promise<"active" | "deactivated" | undefined>;
    liveAdmin?: boolean;
  } = {},
) {
  const verify = vi.fn(async (t: string) => verified(await (opts.verify ?? (async () => ALICE))(t)));
  const identity = createSupabaseIdentity({
    serviceSecret: TEST_SECRET,
    verify,
    status: new UserStatusCache(opts.status ?? (async () => "active")),
  });
  const guards = {
    ...createGuards(identity),
    requireAdmin: createAdminGuard({ isLiveAdmin: async () => opts.liveAdmin ?? true }),
  };
  const a = new Hono<AuthEnv>();
  a.use("*", guards.requireService);
  a.get("/user", guards.requireUser, (c) => c.json({ id: c.get("user").id }));
  a.get("/admin", guards.requireUser, guards.requireAdmin, (c) => c.json({ ok: true }));
  const call = (path: string, headers: Record<string, string> = {}) =>
    a.request(path, { headers: { "x-agent-secret": TEST_SECRET, authorization: "Bearer tok.en.x", ...headers } });
  return { call, verify };
}

describe("service secret", () => {
  it("compares in constant time and rejects missing, short and wrong values", () => {
    expect(serviceSecretMatches(TEST_SECRET, TEST_SECRET)).toBe(true);
    expect(serviceSecretMatches(undefined, TEST_SECRET)).toBe(false);
    expect(serviceSecretMatches("", TEST_SECRET)).toBe(false);
    expect(serviceSecretMatches(TEST_SECRET.slice(1), TEST_SECRET)).toBe(false);
  });

  it("is checked before any token parsing", async () => {
    const { call, verify } = app();
    const res = await call("/user", { "x-agent-secret": "nope" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    expect(verify).not.toHaveBeenCalled();
  });
});

describe("requireUser and requireAdmin", () => {
  it("passes the verified user to the handler", async () => {
    expect(await (await app().call("/user")).json()).toEqual({ id: ALICE.id });
  });

  it("answers signed_out for a bad or expired token and 503 when keys can't be fetched", async () => {
    expect((await app({ verify: async () => Promise.reject(new AuthError("expired_token")) }).call("/user")).status).toBe(401);
    expect((await app().call("/user", { authorization: "Basic abc" })).status).toBe(401);
    const down = await app({ verify: async () => Promise.reject(new AuthError("auth_unavailable")) }).call("/user");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ error: "auth_unavailable" });
  });

  it("answers 403 for a deactivated user and 503 when the status lookup fails", async () => {
    expect((await app({ status: async () => "deactivated" }).call("/user")).status).toBe(403);
    expect((await app({ status: async () => undefined }).call("/user")).status).toBe(403);
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await app({ status: async () => Promise.reject(new Error("db")) }).call("/user")).status).toBe(503);
    quiet.mockRestore();
  });

  it("answers 404 on admin routes unless both the token claim and the live check say admin", async () => {
    expect((await app().call("/admin")).status).toBe(404);
    expect((await app({ verify: async () => ADMIN, liveAdmin: false }).call("/admin")).status).toBe(404);
    expect((await app({ verify: async () => ADMIN }).call("/admin")).status).toBe(200);
  });
});
