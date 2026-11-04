import { describe, expect, it, vi } from "vitest";
import { createSupabaseIdentity, serviceSecretMatches } from "../../src/hosted/identity/supabaseIdentity.js";
import { UserStatusCache } from "../../src/hosted/identity/status.js";
import { AuthError, type VerifiedUser } from "../../src/hosted/identity/verify.js";
import { UserError } from "../../src/lib/errors.js";
import { TEST_SECRET } from "./fixtures/config.js";
import { ALL_CAPABILITIES } from "./fixtures/users.js";

const VERIFIED: VerifiedUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.test",
  sessionId: "sess-1",
  isAdmin: true,
};

function identity(
  opts: { verify?: (t: string) => Promise<VerifiedUser>; status?: () => Promise<"active" | "deactivated" | undefined> } = {},
) {
  const verify = vi.fn(opts.verify ?? (async () => VERIFIED));
  const lookup = vi.fn(opts.status ?? (async () => "active" as const));
  return { id: createSupabaseIdentity({ serviceSecret: TEST_SECRET, verify, status: new UserStatusCache(lookup) }), verify, lookup };
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

describe("serviceSecretMatches", () => {
  it("compares in constant time and rejects missing, short and wrong values", () => {
    expect(serviceSecretMatches(TEST_SECRET, TEST_SECRET)).toBe(true);
    expect(serviceSecretMatches(undefined, TEST_SECRET)).toBe(false);
    expect(serviceSecretMatches("", TEST_SECRET)).toBe(false);
    expect(serviceSecretMatches(TEST_SECRET.slice(1), TEST_SECRET)).toBe(false);
  });
});
