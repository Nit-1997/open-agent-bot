import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@oab/core/config.js";
import { log } from "@oab/core/lib/log.js";
import { loadHostedConfig } from "../src/config.js";
import { TEST_ENV } from "./fixtures/config.js";

const ROOT = resolve(import.meta.dirname, "../../..");

const LOCAL: NodeJS.ProcessEnv = {
  ...TEST_ENV,
  SUPABASE_LOCAL_STACK: "1",
  SUPABASE_URL: "http://127.0.0.1:18741",
  APP_ORIGIN: "http://localhost:18721",
};

const problems = (env: NodeJS.ProcessEnv): string[] => {
  try {
    loadHostedConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
};

afterEach(() => vi.restoreAllMocks());

describe("loadHostedConfig local-stack mode", () => {
  it("accepts a 127.0.0.1 Supabase on a factory port and a localhost app origin, and says so in the log", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => {});
    const cfg = loadHostedConfig(LOCAL);
    expect(cfg).toMatchObject({ supabaseUrl: "http://127.0.0.1:18741", appOrigin: "http://localhost:18721", localStack: true });
    expect(warn).toHaveBeenCalledWith("[config] LOCAL SUPABASE STACK MODE (tests only)");
  });

  it("keeps the sb_ key format: the local stack prints sb_publishable_/sb_secret_ keys (spike A2)", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    expect(
      problems({ ...LOCAL, SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJFUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln", SUPABASE_SECRET_KEY: "plain" }),
    ).toEqual(["SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_", "SUPABASE_SECRET_KEY must start with sb_secret_"]);
  });

  it("leaves the hosted config untouched when the flag is unset", () => {
    expect(loadHostedConfig(TEST_ENV)).not.toHaveProperty("localStack");
    expect(problems({ ...TEST_ENV, SUPABASE_URL: "http://127.0.0.1:18741" })).toEqual(["SUPABASE_URL must be https://<ref>.supabase.co"]);
    expect(problems({ ...TEST_ENV, APP_ORIGIN: "http://localhost:18721" })).toEqual([
      "APP_ORIGIN must be an https origin with no path or trailing slash",
    ]);
  });

  it("refuses the flag together with a supabase.co URL", () => {
    expect(problems({ ...LOCAL, SUPABASE_URL: TEST_ENV.SUPABASE_URL })).toEqual([
      "SUPABASE_LOCAL_STACK=1 refuses a *.supabase.co SUPABASE_URL (local-stack mode is for tests on 127.0.0.1 only)",
    ]);
  });

  it("accepts only 127.0.0.1 on 18700-18749 for Supabase and only localhost on 18700-18749 for the app", () => {
    for (const url of [
      "http://localhost:18741",
      "http://127.0.0.1:54321",
      "http://127.0.0.1:18741/",
      "https://127.0.0.1:18741",
      "http://10.0.0.5:18741",
      "http://127.0.0.1",
    ])
      expect(problems({ ...LOCAL, SUPABASE_URL: url }), url).toEqual([
        "SUPABASE_URL must be https://<ref>.supabase.co (or http://127.0.0.1:<18700-18749> with SUPABASE_LOCAL_STACK=1)",
      ]);
    for (const origin of ["http://127.0.0.1:18721", "http://localhost:3000", "http://localhost:18721/", "http://app.localhost:18721"])
      expect(problems({ ...LOCAL, APP_ORIGIN: origin }), origin).toEqual([
        "APP_ORIGIN must be an https origin with no path or trailing slash (or http://localhost:<18700-18749> with SUPABASE_LOCAL_STACK=1)",
      ]);
  });

  it("accepts only the value 1", () => {
    for (const v of ["true", "yes", "0", " 1"])
      expect(problems({ ...TEST_ENV, SUPABASE_LOCAL_STACK: v }), v).toEqual(["SUPABASE_LOCAL_STACK must be 1 or unset"]);
    expect(loadHostedConfig({ ...TEST_ENV, SUPABASE_LOCAL_STACK: "" })).not.toHaveProperty("localStack");
  });

  it("accepts TURNSTILE_VERIFY_URL only on 127.0.0.1 factory ports, with a secret", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    const secret = "1x0000000000000000000000000000000AA";
    expect(
      loadHostedConfig({ ...LOCAL, TURNSTILE_SECRET_KEY: secret, TURNSTILE_VERIFY_URL: "http://127.0.0.1:18723/siteverify" }).turnstile,
    ).toEqual({
      secret,
      verifyUrl: "http://127.0.0.1:18723/siteverify",
    });
    for (const url of ["http://127.0.0.1:9999", "https://127.0.0.1:18723", "http://localhost:18723", "http://127.0.0.1:18723?x=1"])
      expect(problems({ ...LOCAL, TURNSTILE_SECRET_KEY: secret, TURNSTILE_VERIFY_URL: url }), url).toEqual([
        "TURNSTILE_VERIFY_URL must be http://127.0.0.1:<18700-18749>[/path]",
      ]);
    expect(problems({ ...LOCAL, TURNSTILE_VERIFY_URL: "http://127.0.0.1:18723" })).toEqual([
      "TURNSTILE_VERIFY_URL needs TURNSTILE_SECRET_KEY",
    ]);
  });

  it("accepts the Cloudflare test secrets in local-stack mode", () => {
    vi.spyOn(log, "warn").mockImplementation(() => {});
    for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA"])
      expect(loadHostedConfig({ ...LOCAL, TURNSTILE_SECRET_KEY: secret }).turnstile).toEqual({ secret });
  });

  it("is never set by the hosted Dockerfile, the compose files or the env examples", () => {
    const files = [
      "cloud/agent/Dockerfile",
      "cloud/web/Dockerfile",
      "docker-compose.yml",
      ...readdirSync(join(ROOT, "cloud/deploy-config"))
        .filter((f) => /^compose\..*\.ya?ml$/.test(f))
        .map((f) => `cloud/deploy-config/${f}`),
      ...["backend", "frontend", "ops"].map((g) => `cloud/deploy-config/env-files/${g}/.env.example`),
    ];
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/SUPABASE_LOCAL_STACK|TURNSTILE_VERIFY_URL/);
  });
});
