import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { decodeProtectedHeader, decodeJwt } from "jose";
import { afterAll, describe, expect, it, vi } from "vitest";
import { log } from "@oab/core/lib/log.js";
import { loadHostedConfig } from "../../src/config.js";
import { createVerifier } from "../../src/identity/verify.js";
import { TEST_ENV } from "../fixtures/config.js";
import { anon, cleanup, closeHarness, createUser, invite, localEnv, signIn, sql, testEmail, track } from "./harness.js";

const MIGRATIONS = resolve(import.meta.dirname, "../../../supabase/migrations");

afterAll(async () => {
  try {
    expect(await cleanup()).toBe(0);
  } finally {
    await closeHarness();
  }
});

describe("local Supabase stack smoke", () => {
  it("applied every repo migration, in order", async () => {
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => f.split("_")[0]);
    const rows = await sql<{ version: string }>("select version from supabase_migrations.schema_migrations order by version");
    expect(rows.map((r) => r.version)).toEqual(files);
  });

  it("loads the hosted config in local-stack mode with the stack's own keys", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const env = localEnv();
    const cfg = loadHostedConfig({
      ...TEST_ENV,
      SUPABASE_LOCAL_STACK: "1",
      SUPABASE_URL: env.apiUrl,
      SUPABASE_PUBLISHABLE_KEY: env.publishableKey,
      SUPABASE_SECRET_KEY: env.secretKey,
      APP_ORIGIN: "http://localhost:18721",
    });
    expect(cfg.supabaseUrl).toBe(env.apiUrl);
    vi.restoreAllMocks();
  });

  it("issues ES256 tokens that the hosted verifier accepts against the local JWKS and issuer", async () => {
    const user = await createUser();
    const { accessToken } = await signIn(user);
    expect(decodeProtectedHeader(accessToken)).toMatchObject({ alg: "ES256", typ: "JWT" });
    expect(decodeJwt(accessToken)).toMatchObject({ iss: `${localEnv().apiUrl}/auth/v1`, aud: "authenticated", sub: user.id });
    const verified = await createVerifier({ supabaseUrl: localEnv().apiUrl })(accessToken);
    expect(verified).toMatchObject({ id: user.id, email: user.email, isAdmin: false });
  });

  it("refuses a password sign-in through the custom access token hook", async () => {
    const password = `Pw-${testEmail("pw")}`;
    const user = await createUser({ password });
    const { data, error } = await anon().auth.signInWithPassword({ email: user.email, password });
    expect(data.session).toBeNull();
    expect(error?.message).toBe("Password sign-in is turned off. Use Google or an email link.");
  });

  it("refuses an OTP sign-up for an email that isn't invited", async () => {
    const email = track(testEmail("otp-no"));
    const { error } = await anon().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    expect(error?.message).toBe("Open Agent is invite-only. Request access first.");
    expect(await sql("select 1 from auth.users where email = $1", [email])).toHaveLength(0);
  });

  it("lets an invited email sign up and creates its profile", async () => {
    const email = testEmail("otp-yes");
    await invite(email);
    const { error } = await anon().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    expect(error).toBeNull();
    const users = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
    expect(users).toHaveLength(1);
    expect(await sql("select 1 from public.profiles where user_id = $1 and email = $2", [users[0].id, email])).toHaveLength(1);
  });

  it("records that admin createUser skips the before-user-created hook (only trusted code may call it)", async () => {
    const user = await createUser({ invited: false });
    expect(await sql("select 1 from public.invited_emails where email = $1", [user.email])).toHaveLength(0);
    expect(await sql("select 1 from public.profiles where user_id = $1", [user.id])).toHaveLength(1);
  });
});
