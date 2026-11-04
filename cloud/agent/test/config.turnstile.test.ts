import { describe, expect, it } from "vitest";
import { ConfigError } from "@oab/core/config.js";
import { loadHostedConfig } from "../src/config.js";
import { TEST_ENV } from "./fixtures/config.js";

const REAL = "0x4AAAAAAAsentinelSecretValue_123";

const problems = (env: NodeJS.ProcessEnv): string[] => {
  try {
    loadHostedConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
};

describe("TURNSTILE_SECRET_KEY", () => {
  it("is optional", () => {
    expect(loadHostedConfig(TEST_ENV)).not.toHaveProperty("turnstile");
  });

  it("takes a real secret and always uses Cloudflare's endpoint", () => {
    expect(loadHostedConfig({ ...TEST_ENV, TURNSTILE_SECRET_KEY: REAL }).turnstile).toEqual({ secret: REAL });
  });

  it("refuses the Cloudflare test secrets outside local-stack mode, naming the variable and never the value", () => {
    for (const secret of [
      "1x0000000000000000000000000000000AA",
      "2x0000000000000000000000000000000AA",
      "3x0000000000000000000000000000000AA",
    ]) {
      const got = problems({ ...TEST_ENV, TURNSTILE_SECRET_KEY: secret });
      expect(got).toEqual(["TURNSTILE_SECRET_KEY is a Cloudflare test secret; test secrets are accepted only with SUPABASE_LOCAL_STACK=1"]);
      expect(got.join(" ")).not.toContain(secret);
    }
  });

  it("refuses a value that isn't a Turnstile secret, without echoing it", () => {
    const got = problems({ ...TEST_ENV, TURNSTILE_SECRET_KEY: "hunter2-not-a-key" });
    expect(got).toEqual(["TURNSTILE_SECRET_KEY is not a Turnstile secret key"]);
  });

  it("refuses TURNSTILE_VERIFY_URL outside local-stack mode", () => {
    expect(problems({ ...TEST_ENV, TURNSTILE_SECRET_KEY: REAL, TURNSTILE_VERIFY_URL: "http://127.0.0.1:18723" })).toEqual([
      "TURNSTILE_VERIFY_URL is accepted only with SUPABASE_LOCAL_STACK=1",
    ]);
  });
});
