import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { guardLocalEnv, HarnessRefusal, LIVE_ENV, localEnv, REFUSAL, STACK_ENV } from "./harness.js";

const GOOD: NodeJS.ProcessEnv = {
  OAB_SB_API_URL: "http://127.0.0.1:18741",
  OAB_SB_DB_URL: "postgresql://postgres:postgres@127.0.0.1:18742/postgres",
  OAB_SB_PUBLISHABLE_KEY: "sb_publishable_local",
  OAB_SB_SECRET_KEY: "sb_secret_local",
  OAB_SB_MAIL_URL: "http://127.0.0.1:18744",
};

const refusal = (env: NodeJS.ProcessEnv): string => {
  try {
    guardLocalEnv(env);
  } catch (err) {
    expect(err).toBeInstanceOf(HarnessRefusal);
    expect((err as HarnessRefusal).code).toBe(REFUSAL);
    return (err as Error).message;
  }
  throw new Error("expected a refusal");
};

describe("local harness guard (Security M1)", () => {
  it("accepts a complete 127.0.0.1 stack env on factory ports", () => {
    expect(guardLocalEnv(GOOD)).toEqual({
      apiUrl: "http://127.0.0.1:18741",
      dbUrl: "postgresql://postgres:postgres@127.0.0.1:18742/postgres",
      publishableKey: "sb_publishable_local",
      secretKey: "sb_secret_local",
      mailUrl: "http://127.0.0.1:18744",
    });
  });

  it("reports no stack when none of the OAB_SB_* variables is set, and localEnv refuses then", () => {
    expect(guardLocalEnv({})).toBeUndefined();
    expect(() => localEnv({})).toThrow(/local_stack_only: no local stack env/);
  });

  for (const name of LIVE_ENV) {
    it(`refuses ${name}, with or without a stack env`, () => {
      expect(refusal({ ...GOOD, [name]: "x" })).toMatch(new RegExp(`local_stack_only: refusing to run with ${name} set`));
      expect(refusal({ [name]: "x" })).toMatch(new RegExp(name));
    });
  }

  for (const name of STACK_ENV) {
    it(`refuses an incomplete stack env without ${name}`, () => {
      expect(refusal({ ...GOOD, [name]: undefined })).toMatch(new RegExp(`incomplete local stack env: ${name} missing`));
    });
  }

  it("refuses a database host other than 127.0.0.1", () => {
    for (const url of [
      "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
      "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
      "postgresql://postgres:postgres@localhost:18742/postgres",
      "postgresql://postgres:postgres@127.0.0.2:18742/postgres",
      "postgresql://postgres:postgres@[::1]:18742/postgres",
    ])
      expect(refusal({ ...GOOD, OAB_SB_DB_URL: url }), url).toMatch(/OAB_SB_DB_URL host must be 127\.0\.0\.1/);
  });

  it("refuses a database port outside 18700-18749", () => {
    for (const url of [
      "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "postgresql://postgres:postgres@127.0.0.1:18750/postgres",
      "postgresql://postgres:postgres@127.0.0.1:18699/postgres",
      "postgresql://postgres:postgres@127.0.0.1/postgres",
    ])
      expect(refusal({ ...GOOD, OAB_SB_DB_URL: url }), url).toMatch(/OAB_SB_DB_URL port must be 18700-18749/);
    expect(refusal({ ...GOOD, OAB_SB_DB_URL: "mysql://127.0.0.1:18742/x" })).toMatch(/postgresql:\/\//);
    expect(refusal({ ...GOOD, OAB_SB_DB_URL: "nope" })).toMatch(/not a URL/);
  });

  it("refuses an API URL that isn't http://127.0.0.1:<18700-18749>", () => {
    for (const url of [
      "https://abcdefghijklmnopqrst.supabase.co",
      "https://127.0.0.1:18741",
      "http://localhost:18741",
      "http://127.0.0.1:54321",
      "http://127.0.0.1:18741/",
      "http://127.0.0.1:18741/auth/v1",
      "http://user:pw@127.0.0.1:18741",
    ])
      expect(refusal({ ...GOOD, OAB_SB_API_URL: url }), url).toMatch(/OAB_SB_API_URL must be http:\/\/127\.0\.0\.1:<18700-18749>/);
  });

  it("refuses keys that aren't the local stack's sb_ keys", () => {
    expect(refusal({ ...GOOD, OAB_SB_PUBLISHABLE_KEY: "eyJx.eyJy.z" })).toMatch(/sb_publishable_/);
    expect(refusal({ ...GOOD, OAB_SB_SECRET_KEY: "service-role" })).toMatch(/sb_secret_/);
  });

  describe("npm run test:local", () => {
    const run = (env: NodeJS.ProcessEnv) => {
      const clean = Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith("OAB_SB_") && !(LIVE_ENV as readonly string[]).includes(k)),
      );
      return spawnSync("npx", ["vitest", "run", "-c", "vitest.local.config.ts"], {
        cwd: resolve(import.meta.dirname, "../.."),
        env: { ...clean, ...env },
        encoding: "utf8",
        timeout: 60_000,
      });
    };

    it("refuses before any test runs when the stack env points at a live database", () => {
      const res = run({ ...GOOD, OAB_SB_DB_URL: "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" });
      expect(res.status).toBe(2);
      expect(res.stderr).toMatch(/local_stack_only: OAB_SB_DB_URL host must be 127\.0\.0\.1/);
      expect(res.stdout).not.toMatch(/Test Files/);
    });

    it("refuses when a Supabase access token is set", () => {
      const res = run({ SUPABASE_ACCESS_TOKEN: "sbp_test" });
      expect(res.status).toBe(2);
      expect(res.stderr).toMatch(/local_stack_only: refusing to run with SUPABASE_ACCESS_TOKEN set/);
    });

    it("prints SKIP and passes with no stack env", () => {
      const res = run({});
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/SKIP \(no local stack\)/);
    });
  });
});
