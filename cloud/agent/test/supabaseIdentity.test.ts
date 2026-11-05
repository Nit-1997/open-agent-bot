import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseIdentity, serviceSecretMatches } from "../src/identity/supabaseIdentity.js";
import { UserStatusCache } from "../src/identity/status.js";
import { AuthError, type VerifiedUser } from "../src/identity/verify.js";
import { UserError } from "@oab/core/lib/errors.js";
import { TEST_SECRET } from "./fixtures/config.js";
import { NO_CAPABILITIES } from "@oab/core/identity/types.js";
import { ALL_CAPABILITIES } from "./fixtures/users.js";

const VERIFIED: VerifiedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.test",
  sessionId: "sess-1",
  isAdmin: true,
};

function identity(
  opts: {
    verify?: (t: string) => Promise<VerifiedUser>;
    status?: () => Promise<"active" | "deactivated" | undefined>;
    liveAdmin?: (userId: string) => Promise<boolean>;
    onDemoted?: (userId: string) => Promise<void>;
  } = {},
) {
  const verify = vi.fn(opts.verify ?? (async () => VERIFIED));
  const lookup = vi.fn(opts.status ?? (async () => "active" as const));
  const liveAdmin = vi.fn(opts.liveAdmin ?? (async () => true));
  const onDemoted = vi.fn(opts.onDemoted ?? (async () => {}));
  const id = createSupabaseIdentity({ serviceSecret: TEST_SECRET, verify, status: new UserStatusCache(lookup), liveAdmin, onDemoted });
  return { id, verify, lookup, liveAdmin, onDemoted };
}

const request = (headers: Record<string, string>) => new Request("http://agent/chats", { headers });

describe("createSupabaseIdentity", () => {
  it("is the hosted identity", () => {
    expect(identity().id.kind).toBe("hosted");
  });

  it("admits a caller with the service secret", () => {
    expect(identity().id.admitCaller(request({ "x-agent-secret": TEST_SECRET }))).toBeUndefined();
  });

  it("refuses a wrong, short or missing secret even with a valid bearer, without verifying it", () => {
    const { id, verify } = identity();
    const secrets: Array<Record<string, string>> = [
      { "x-agent-secret": "nope" },
      { "x-agent-secret": TEST_SECRET.slice(1) },
      { "x-agent-secret": "" },
      {},
    ];
    for (const headers of secrets) {
      const refused = id.admitCaller(request({ ...headers, authorization: "Bearer tok.en.x" }));
      expect(refused).toBeInstanceOf(UserError);
      expect(refused).toMatchObject({ kind: "unauthorized", code: "unauthorized", message: "Unauthorized." });
    }
    expect(verify).not.toHaveBeenCalled();
  });

  it("maps a VerifiedUser to a Principal without the sessionId", async () => {
    const outcome = await identity().id.authenticate(request({ authorization: "Bearer tok.en.x" }));
    expect(outcome).toEqual({ ok: true, principal: { id: VERIFIED.id, email: VERIFIED.email, capabilities: ALL_CAPABILITIES } });
    expect(outcome.ok && outcome.principal).not.toHaveProperty("sessionId");
  });

  it("passes the bearer token to the verifier and checks the account status", async () => {
    const { id, verify, lookup } = identity();
    await id.authenticate(request({ authorization: "Bearer tok.en.x" }));
    expect(verify).toHaveBeenCalledWith("tok.en.x");
    expect(lookup).toHaveBeenCalledWith(VERIFIED.id);
  });

  it("answers signed_out for a missing, malformed, invalid or expired bearer", async () => {
    const cases: Array<[Record<string, string>, ((t: string) => Promise<VerifiedUser>) | undefined]> = [
      [{}, undefined],
      [{ authorization: "Basic abc" }, undefined],
      [{ authorization: "Bearer a b" }, undefined],
      [{ authorization: "Bearer tok" }, async () => Promise.reject(new AuthError("invalid_token"))],
      [{ authorization: "Bearer tok" }, async () => Promise.reject(new AuthError("expired_token"))],
      [{ authorization: "Bearer tok" }, async () => Promise.reject(new Error("boom"))],
    ];
    for (const [headers, verify] of cases) {
      const outcome = await identity({ verify }).id.authenticate(request(headers));
      expect(outcome.ok).toBe(false);
      expect(!outcome.ok && outcome.error).toMatchObject({
        kind: "unauthorized",
        code: "signed_out",
        message: "You were signed out. Sign in again.",
      });
    }
  });

  it("answers auth_unavailable when the key set can't be fetched or the status lookup fails", async () => {
    const down = await identity({ verify: async () => Promise.reject(new AuthError("auth_unavailable")) }).id.authenticate(
      request({ authorization: "Bearer tok" }),
    );
    expect(!down.ok && down.error).toMatchObject({ kind: "unavailable", code: "auth_unavailable" });
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookupFails = await identity({ status: async () => Promise.reject(new Error("db")) }).id.authenticate(
      request({ authorization: "Bearer tok" }),
    );
    quiet.mockRestore();
    expect(!lookupFails.ok && lookupFails.error).toMatchObject({ kind: "unavailable", code: "auth_unavailable" });
  });

  it("answers account_disabled for a deactivated or unknown account", async () => {
    for (const status of [async () => "deactivated" as const, async () => undefined]) {
      const outcome = await identity({ status }).id.authenticate(request({ authorization: "Bearer tok" }));
      expect(!outcome.ok && outcome.error).toMatchObject({ kind: "forbidden", code: "account_disabled" });
    }
  });
});

const MEMBER: VerifiedUser = { ...VERIFIED, isAdmin: false };
const bearer = () => request({ authorization: "Bearer tok.en.x" });

async function principalOf(id: ReturnType<typeof identity>["id"]) {
  const outcome = await id.authenticate(bearer());
  if (!outcome.ok) throw outcome.error;
  return outcome.principal;
}

describe("createSupabaseIdentity live admin check", () => {
  afterEach(() => vi.restoreAllMocks());

  it("grants the admin capabilities only when the claim and the live check both say admin", async () => {
    const both = identity();
    const admin = await principalOf(both.id);
    expect(admin.capabilities).toEqual(ALL_CAPABILITIES);
    expect(both.liveAdmin).toHaveBeenCalledWith(VERIFIED.id);
    expect(both.id.roleUnverified(admin)).toBe(false);
    const denied = identity({ liveAdmin: async () => false });
    expect((await principalOf(denied.id)).capabilities).toEqual(NO_CAPABILITIES);
  });

  it("never looks a member up", async () => {
    const { id, liveAdmin, onDemoted } = identity({ verify: async () => MEMBER });
    for (let i = 0; i < 3; i++) expect((await principalOf(id)).capabilities).toEqual(NO_CAPABILITIES);
    expect(liveAdmin).not.toHaveBeenCalled();
    expect(onDemoted).not.toHaveBeenCalled();
  });

  it("serves the request without privileges when the live lookup fails, and marks only that principal unverified", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let down = true;
    const { id, onDemoted } = identity({ liveAdmin: async () => (down ? Promise.reject(new Error("auth admin down")) : true) });
    const blip = await principalOf(id);
    expect(blip).toEqual({ id: VERIFIED.id, email: VERIFIED.email, capabilities: NO_CAPABILITIES });
    expect(id.roleUnverified(blip)).toBe(true);
    expect(warn.mock.calls.flat().join(" ")).toContain(`[auth] live admin check failed user=${VERIFIED.id}`);
    down = false;
    const back = await principalOf(id);
    expect(back.capabilities).toEqual(ALL_CAPABILITIES);
    expect(id.roleUnverified(back)).toBe(false);
    expect(onDemoted).not.toHaveBeenCalled();
  });

  it("treats a lookup error as no transition: an admin who hits a blip is not demoted", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let live: () => Promise<boolean> = async () => true;
    const { id, onDemoted } = identity({ liveAdmin: () => live() });
    await principalOf(id);
    live = async () => Promise.reject(new Error("auth admin down"));
    await principalOf(id);
    await principalOf(id);
    expect(onDemoted).not.toHaveBeenCalled();
    live = async () => false;
    await principalOf(id);
    expect(onDemoted).toHaveBeenCalledTimes(1);
  });

  it("calls onDemoted once when the live check turns an admin into a member, and waits for it", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    let live = true;
    const order: string[] = [];
    const { id, onDemoted } = identity({
      liveAdmin: async () => live,
      onDemoted: async (userId) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(`demoted ${userId}`);
      },
    });
    await principalOf(id);
    live = false;
    const after = await principalOf(id);
    order.push("served");
    expect(after.capabilities).toEqual(NO_CAPABILITIES);
    expect(order).toEqual([`demoted ${VERIFIED.id}`, "served"]);
    await principalOf(id);
    expect(onDemoted).toHaveBeenCalledTimes(1);
    expect(info.mock.calls.flat().join(" ")).toContain(`[auth] admin role ended user=${VERIFIED.id}, dropping their sessions`);
  });

  it("calls onDemoted exactly once when a refreshed token drops the admin claim, without a lookup", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let user = VERIFIED;
    const { id, liveAdmin, onDemoted } = identity({ verify: async () => user });
    await principalOf(id);
    expect(liveAdmin).toHaveBeenCalledTimes(1);
    user = MEMBER;
    await Promise.all([principalOf(id), principalOf(id)]);
    await principalOf(id);
    expect(liveAdmin).toHaveBeenCalledTimes(1);
    expect(onDemoted.mock.calls).toEqual([[VERIFIED.id]]);
  });

  it("calls onDemoted again after a re-promotion and a second demotion", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let live = true;
    const { id, onDemoted } = identity({ liveAdmin: async () => live });
    for (const step of [true, false, true, false]) {
      live = step;
      await principalOf(id);
    }
    expect(onDemoted).toHaveBeenCalledTimes(2);
  });

  it("never demotes a user it never saw as an admin", async () => {
    const { id, onDemoted } = identity({ liveAdmin: async () => false });
    await principalOf(id);
    await principalOf(id);
    expect(onDemoted).not.toHaveBeenCalled();
  });

  it("still serves the request when onDemoted fails, logging the failure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let live = true;
    const { id } = identity({ liveAdmin: async () => live, onDemoted: async () => Promise.reject(new Error("forget failed")) });
    await principalOf(id);
    live = false;
    expect((await principalOf(id)).capabilities).toEqual(NO_CAPABILITIES);
    expect(error.mock.calls.flat().join(" ")).toContain(`[auth] demotion cleanup failed user=${VERIFIED.id}`);
  });

  it("forgets the oldest remembered admin after 10,000", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let n = 0;
    let live = true;
    const { id, onDemoted } = identity({ verify: async () => ({ ...VERIFIED, id: `admin-${n}` }), liveAdmin: async () => live });
    for (n = 0; n <= 10_000; n++) await principalOf(id);
    live = false;
    n = 0;
    await principalOf(id);
    n = 10_000;
    await principalOf(id);
    expect(onDemoted.mock.calls).toEqual([["admin-10000"]]);
  });
});

describe("serviceSecretMatches", () => {
  it("compares in constant time and rejects missing, short and wrong values", () => {
    expect(serviceSecretMatches(TEST_SECRET, TEST_SECRET)).toBe(true);
    expect(serviceSecretMatches(undefined, TEST_SECRET)).toBe(false);
    expect(serviceSecretMatches("", TEST_SECRET)).toBe(false);
    expect(serviceSecretMatches(TEST_SECRET.slice(1), TEST_SECRET)).toBe(false);
  });
});
