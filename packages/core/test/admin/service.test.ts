import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthAccount, AuthAdmin } from "../../src/admin/authAdmin.js";
import { createAuthAdmin } from "../../src/admin/authAdmin.js";
import { DELETE_STEPS, deleteAccount } from "../../src/admin/deleteAccount.js";
import { createAdminService, createLiveAdminCheck } from "../../src/admin/service.js";
import { createAnonClient, createServiceClient } from "../../src/db/client.js";
import { FakeAccounts } from "../fixtures/app.js";
import { ADMIN, ALICE, BOB } from "../fixtures/users.js";

const account = (over: Partial<AuthAccount> = {}): AuthAccount => ({
  id: ADMIN.id,
  email: ADMIN.email,
  isAdmin: true,
  bannedUntil: null,
  lastSignInAt: null,
  providers: ["google"],
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("createLiveAdminCheck", () => {
  it("caches the answer per user for 30 s, then asks again", async () => {
    let now = 1_000_000;
    const getUser = vi.fn(async () => account());
    const check = createLiveAdminCheck({ getUser }, () => now);
    expect(await check(ADMIN)).toBe(true);
    now += 29_999;
    expect(await check(ADMIN)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
    now += 1;
    getUser.mockResolvedValueOnce(account({ isAdmin: false }));
    expect(await check(ADMIN)).toBe(false);
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(await check(ALICE)).toBe(true);
    expect(getUser).toHaveBeenCalledTimes(3);
  });

  it("denies a banned admin until the ban runs out, and missing or member accounts", async () => {
    let now = Date.parse("2026-11-01T00:00:00Z");
    const getUser = vi.fn(async () => account({ bannedUntil: "2026-11-01T01:00:00Z" }));
    const check = createLiveAdminCheck({ getUser }, () => now);
    expect(await check(ADMIN)).toBe(false);
    now = Date.parse("2026-11-01T01:00:00Z");
    expect(await check(ADMIN)).toBe(true);
    expect(await createLiveAdminCheck({ getUser: async () => undefined })(ADMIN)).toBe(false);
    expect(await createLiveAdminCheck({ getUser: async () => account({ isAdmin: false }) })(ADMIN)).toBe(false);
  });
});

function authWith(reply: (url: URL, init: RequestInit) => Response) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init.method ?? "GET"} ${url.pathname}`);
    return reply(url, init);
  }) as typeof fetch;
  const cfg = {
    supabaseUrl: "https://stub.supabase.test",
    supabaseSecretKey: "sb_secret_test",
    supabasePublishableKey: "sb_publishable_test",
  };
  return {
    auth: createAuthAdmin({
      service: createServiceClient(cfg, { fetch }),
      anon: createAnonClient(cfg, { fetch }),
      appOrigin: "https://app.test",
    }),
    calls,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createAuthAdmin", () => {
  it("maps a missing user to undefined and a refusal to upstream", async () => {
    expect(await authWith(() => json(404, { code: "user_not_found", msg: "User not found" })).auth.getUser(ALICE.id)).toBeUndefined();
    await expect(authWith(() => json(500, { code: "unexpected_failure", msg: "boom" })).auth.getUser(ALICE.id)).rejects.toMatchObject({
      kind: "upstream",
    });
  });

  it("maps an unreachable service to unavailable", async () => {
    const { auth } = authWith(() => {
      throw new TypeError("fetch failed");
    });
    await expect(auth.getUser(ALICE.id)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(auth.setBanned(ALICE.id, true)).rejects.toMatchObject({ kind: "unavailable" });
    expect(await auth.magicLink(ALICE.email)).toMatchObject({ ok: false, code: "unreachable" });
  });

  it("reads the account fields it needs", async () => {
    const { auth } = authWith(() =>
      json(200, {
        id: ALICE.id,
        email: "Alice@Example.TEST",
        app_metadata: { role: "admin" },
        banned_until: null,
        last_sign_in_at: "2026-11-01T00:00:00Z",
        identities: [{ provider: "google" }, { provider: "email" }, { provider: "google" }],
      }),
    );
    expect(await auth.getUser(ALICE.id)).toEqual({
      id: ALICE.id,
      email: "alice@example.test",
      isAdmin: true,
      bannedUntil: null,
      lastSignInAt: "2026-11-01T00:00:00Z",
      providers: ["email", "google"],
    });
  });

  it("returns invite and sign-in link failures with their code instead of throwing", async () => {
    const { auth, calls } = authWith((url) =>
      url.pathname.endsWith("/invite")
        ? json(422, { code: 422, error_code: "email_exists", msg: "exists" })
        : json(400, { code: 400, error_code: "otp_disabled", msg: "Signups not allowed for otp" }),
    );
    expect(await auth.invite("new@example.test", "New")).toMatchObject({ ok: false, code: "email_exists" });
    expect(await auth.magicLink("new@example.test")).toMatchObject({ ok: false, code: "otp_disabled" });
    expect(calls).toEqual(["POST /auth/v1/invite", "POST /auth/v1/otp"]);
  });

  it("treats deleting an already deleted user as done", async () => {
    await expect(authWith(() => json(404, { code: "user_not_found", msg: "gone" })).auth.deleteUser(ALICE.id)).resolves.toBeUndefined();
    await expect(authWith(() => json(500, { code: "x", msg: "boom" })).auth.deleteUser(ALICE.id)).rejects.toMatchObject({
      kind: "upstream",
    });
  });
});

function recordingRemoval(failAt?: string) {
  const order: string[] = [];
  const step = (name: string) => async () => {
    order.push(name);
    if (name === failAt) throw new Error(`${name} failed`);
  };
  return {
    order,
    deps: {
      repo: {
        storage: { removeUserFiles: step("storage") },
        accessRequests: { deleteByEmail: step("requests.deleteByEmail") },
        invited: { remove: step("invited.remove") },
      },
      auth: { deleteUser: step("auth.deleteUser") },
    } as unknown as Parameters<typeof deleteAccount>[0],
  };
}

describe("deleteAccount", () => {
  it("removes files, then requests and invites, then the auth user", async () => {
    const { order, deps } = recordingRemoval();
    const steps: string[] = [];
    await deleteAccount(deps, { id: BOB.id, email: BOB.email }, async (name, fn) => {
      steps.push(name);
      await fn();
    });
    expect(order).toEqual(["storage", "requests.deleteByEmail", "invited.remove", "auth.deleteUser"]);
    expect(steps).toEqual([...DELETE_STEPS]);
  });

  it("stops at the first failing step", async () => {
    const { order, deps } = recordingRemoval("requests.deleteByEmail");
    await expect(deleteAccount(deps, { id: BOB.id, email: BOB.email })).rejects.toThrow("requests.deleteByEmail failed");
    expect(order).toEqual(["storage", "requests.deleteByEmail"]);
  });
});

describe("admin service remove", () => {
  it("turns access off before deleting and names the step that failed", async () => {
    const accounts = new FakeAccounts();
    for (const u of [ADMIN, BOB]) accounts.add(u);
    const order: string[] = [];
    const repo = accounts.repo();
    const auth: AuthAdmin = accounts.auth();
    const service = createAdminService({
      repo: {
        ...repo,
        storage: {
          removeUserFiles: async () => {
            order.push("storage");
          },
        },
        invited: {
          ...repo.invited,
          remove: async () => {
            order.push("invited");
            throw new Error("db down");
          },
        },
      },
      auth: {
        ...auth,
        setBanned: async (id, banned) => {
          order.push(`ban:${banned}`);
          await accounts.auth().setBanned(id, banned);
        },
      },
      hooks: {
        onDisabled: async () => {
          order.push("disabled");
        },
        onEnabled: () => {},
      },
    });
    await expect(service.remove(ADMIN, BOB.id, ` ${BOB.email.toUpperCase()} `)).rejects.toMatchObject({
      kind: "internal",
      code: "delete_failed",
      opts: { details: { step: "requests" } },
    });
    expect(order).toEqual(["ban:true", "disabled", "storage", "invited"]);
    expect(accounts.users.has(BOB.id)).toBe(true);
  });

  it("refuses a wrong confirmation and self-deletion before touching anything", async () => {
    const accounts = new FakeAccounts();
    for (const u of [ADMIN, BOB]) accounts.add(u);
    const service = createAdminService({
      repo: accounts.repo(),
      auth: accounts.auth(),
      hooks: { onDisabled: async () => {}, onEnabled: () => {} },
    });
    await expect(service.remove(ADMIN, BOB.id, "someone@example.test")).rejects.toMatchObject({ kind: "unprocessable" });
    await expect(service.remove(ADMIN, ADMIN.id, ADMIN.email)).rejects.toMatchObject({ code: "self_action" });
    expect(accounts.users.get(BOB.id)?.status).toBe("active");
  });
});
