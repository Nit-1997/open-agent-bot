import { createHmac, createPublicKey } from "node:crypto";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, createVerifier } from "../../src/auth/verify.js";

const URL_BASE = "https://abcdefghijklmnopqrst.supabase.co";
const ISS = `${URL_BASE}/auth/v1`;
const SUB = "11111111-1111-4111-8111-111111111111";

let es: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: JWK;
let fetches = 0;

const jwksFetch: typeof fetch = async () => {
  fetches++;
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
};

const claims = (over: Record<string, unknown> = {}) => ({
  sub: SUB,
  email: "Alice@Example.test",
  session_id: "sess-1",
  role: "authenticated",
  aud: "authenticated",
  iss: ISS,
  is_anonymous: false,
  app_metadata: { role: "admin" },
  ...over,
});

async function sign(over: Record<string, unknown> = {}, opts: { kid?: string; exp?: number | string; typ?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims(over))
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "k1", ...(opts.typ && { typ: opts.typ }) })
    .setIssuedAt(now)
    .setExpirationTime(opts.exp ?? now + 900)
    .sign(es.privateKey);
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

beforeAll(async () => {
  es = await generateKeyPair("ES256", { extractable: true });
  jwk = { ...(await exportJWK(es.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
});

const verifier = () => createVerifier({ supabaseUrl: URL_BASE }, { fetch: jwksFetch });
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof AuthError ? e.code : String(e)),
  );

describe("createVerifier", () => {
  it("accepts a valid ES256 access token and takes the user only from it", async () => {
    const user = await verifier()(await sign());
    expect(user).toEqual({ id: SUB, email: "alice@example.test", sessionId: "sess-1", isAdmin: true });
  });

  it("reports admin only from app_metadata", async () => {
    expect((await verifier()(await sign({ app_metadata: {}, user_metadata: { role: "admin" } }))).isAdmin).toBe(false);
  });

  it("rejects alg none", async () => {
    const token = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(claims({ exp: Date.now() / 1000 + 900 })))}.`;
    expect(await code(verifier()(token))).toBe("invalid_token");
  });

  it("rejects HS256 signed with the public key bytes", async () => {
    const pem = createPublicKey({ key: jwk as never, format: "jwk" }).export({ type: "spki", format: "pem" });
    const head = b64url(JSON.stringify({ alg: "HS256", kid: "k1" }));
    const body = b64url(JSON.stringify(claims({ exp: Math.floor(Date.now() / 1000) + 900, iat: Math.floor(Date.now() / 1000) })));
    const sig = createHmac("sha256", pem).update(`${head}.${body}`).digest("base64url");
    expect(await code(verifier()(`${head}.${body}.${sig}`))).toBe("invalid_token");
  });

  it("rejects RS256 tokens", async () => {
    const rs = await generateKeyPair("RS256");
    const token = await new SignJWT(claims())
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(rs.privateKey);
    expect(await code(verifier()(token))).toBe("invalid_token");
  });

  it("rejects the wrong issuer, audience, role or an anonymous user", async () => {
    const v = verifier();
    expect(await code(v(await sign({ iss: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co/auth/v1" })))).toBe("invalid_token");
    expect(await code(v(await sign({ aud: "anon" })))).toBe("invalid_token");
    expect(await code(v(await sign({ role: "anon" })))).toBe("invalid_token");
    expect(await code(v(await sign({ is_anonymous: true })))).toBe("invalid_token");
  });

  it("rejects missing session_id, a non-uuid sub and a bad typ", async () => {
    const v = verifier();
    expect(await code(v(await sign({ session_id: undefined })))).toBe("invalid_token");
    expect(await code(v(await sign({ sub: "not-a-uuid" })))).toBe("invalid_token");
    expect(await code(v(await sign({}, { typ: "at+jwt" })))).toBe("invalid_token");
  });

  it("reports an expired token beyond the clock tolerance, but allows 30 s of skew", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await code(verifier()(await sign({}, { exp: now - 120 })))).toBe("expired_token");
    expect(await code(verifier()(await sign({}, { exp: now - 10 })))).toBe("ok");
  });

  it("refetches the key set once for an unknown kid, then fails", async () => {
    const v = verifier();
    await v(await sign());
    const before = fetches;
    expect(await code(v(await sign({}, { kid: "rotated" })))).toBe("invalid_token");
    expect(fetches - before).toBeLessThanOrEqual(1);
  });

  it("rejects tokens over 8 KB before parsing", async () => {
    expect(await code(verifier()(`${"a".repeat(9 * 1024)}.b.c`))).toBe("invalid_token");
  });

  it("fails closed with auth_unavailable when the key set can't be fetched", async () => {
    const down = createVerifier({ supabaseUrl: URL_BASE }, { fetch: async () => Promise.reject(new TypeError("fetch failed")) });
    expect(await code(down(await sign()))).toBe("auth_unavailable");
  });
});
