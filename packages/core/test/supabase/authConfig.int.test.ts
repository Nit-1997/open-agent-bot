import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestUser, deleteCreatedUsers, enabled, env, remainingRows, sessionFor, type TestUser } from "./helpers.js";

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

describe.skipIf(!enabled)("auth settings (live project)", () => {
  let user: TestUser;
  const authApi = (method: string, path: string, body: object) =>
    fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
      method,
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${user.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    user = await createTestUser();
  }, 60_000);

  afterAll(async () => {
    expect(await remainingRows(await deleteCreatedUsers())).toBe(0);
  }, 60_000);

  it("never turns a password set with a stolen access token into a working sign-in", async () => {
    const password = `Pw-${crypto.randomUUID()}-x`;
    await authApi("PUT", "/user", { password });
    const signIn = await createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: AUTH }).auth.signInWithPassword({
      email: user.email,
      password,
    });
    expect(signIn.data.session).toBeNull();
    expect(signIn.error?.message).toMatch(/Password sign-in is turned off/);
  });

  it("still signs people in with email links", async () => {
    const again = await sessionFor(user.email);
    expect(again.accessToken).toBeTruthy();
  });

  it("offers no MFA enrolment", async () => {
    const res = await authApi("POST", "/factors", { factor_type: "totp" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
