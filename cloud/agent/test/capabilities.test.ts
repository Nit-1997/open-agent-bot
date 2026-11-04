import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { hostedCapabilities } from "../src/identity/capabilities.js";
import { UserStatusCache } from "../src/identity/status.js";
import { createSupabaseIdentity } from "../src/identity/supabaseIdentity.js";
import { createVerifier } from "../src/identity/verify.js";
import { NO_CAPABILITIES } from "@oab/core/identity/types.js";
import { TEST_SECRET } from "./fixtures/config.js";

const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co";
const SUB = "11111111-1111-4111-8111-111111111111";
const ALL = { admin: true, privateNetworkModels: true, operatorGateway: true };

let es: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: JWK;

beforeAll(async () => {
  es = await generateKeyPair("ES256", { extractable: true });
  jwk = { ...(await exportJWK(es.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
});

async function sign(metadata: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: SUB,
    email: "alice@example.test",
    session_id: "sess-1",
    role: "authenticated",
    aud: "authenticated",
    iss: `${URL_BASE}/auth/v1`,
    is_anonymous: false,
    ...metadata,
  })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuedAt(now)
    .setExpirationTime(now + 900)
    .sign(es.privateKey);
}

async function capabilitiesFor(metadata: Record<string, unknown>) {
  const jwksFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  const identity = createSupabaseIdentity({
    serviceSecret: TEST_SECRET,
    verify: createVerifier({ supabaseUrl: URL_BASE }, { fetch: jwksFetch }),
    status: new UserStatusCache(async () => "active"),
    liveAdmin: async () => true,
    onDemoted: async () => {},
  });
  const outcome = await identity.authenticate(
    new Request("http://agent/chats", { headers: { authorization: `Bearer ${await sign(metadata)}` } }),
  );
  if (!outcome.ok) throw outcome.error;
  return outcome.principal.capabilities;
}

describe("hostedCapabilities", () => {
  it("grants all three to an effective admin and none otherwise", () => {
    expect(hostedCapabilities(true)).toEqual(ALL);
    expect(hostedCapabilities(false)).toEqual(NO_CAPABILITIES);
  });

  it("returns frozen values, as is NO_CAPABILITIES", () => {
    expect(Object.isFrozen(hostedCapabilities(true))).toBe(true);
    expect(Object.isFrozen(hostedCapabilities(false))).toBe(true);
    expect(Object.isFrozen(NO_CAPABILITIES)).toBe(true);
    expect(NO_CAPABILITIES).toEqual({ admin: false, privateNetworkModels: false, operatorGateway: false });
  });
});

describe("hosted identity capabilities from the access token and a passing live check", () => {
  it("grants all three for app_metadata.role admin", async () => {
    const caps = await capabilitiesFor({ app_metadata: { role: "admin" } });
    expect(caps).toEqual(ALL);
    expect(Object.isFrozen(caps)).toBe(true);
  });

  const denied: Array<[string, Record<string, unknown>]> = [
    ["user_metadata.role admin", { app_metadata: {}, user_metadata: { role: "admin" } }],
    ["a top-level admin claim", { app_metadata: {}, admin: true, capabilities: ALL }],
    ["app_metadata.role Admin", { app_metadata: { role: "Admin" } }],
    ["app_metadata.role owner", { app_metadata: { role: "owner" } }],
    ["app_metadata.roles [admin]", { app_metadata: { roles: ["admin"] } }],
    ["no app_metadata", {}],
  ];
  for (const [name, metadata] of denied) {
    it(`grants nothing for ${name}`, async () => {
      expect(await capabilitiesFor(metadata)).toEqual(NO_CAPABILITIES);
    });
  }
});
