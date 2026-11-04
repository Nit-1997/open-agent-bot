import { ConfigError } from "@oab/core/config.js";
import { describe, expect, it } from "vitest";
import { loadHostedConfig } from "../src/config.js";

const S = "qzsentinelqzsentinel";
const HEX = "5e47e1".repeat(10).padEnd(64, "a");
const B64 = Buffer.from(`${S}${S}`.slice(0, 32)).toString("base64");

const VALID: NodeJS.ProcessEnv = {
  SUPABASE_URL: `https://${S}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${S}`,
  SUPABASE_SECRET_KEY: `sb_secret_${S}`,
  AGENT_SERVICE_SECRET: HEX,
  CREDENTIAL_KEYS: `v2:${B64},v1:${Buffer.alloc(32, 7).toString("base64")}`,
  APP_ORIGIN: `https://${S}.example`,
  ACCESS_REQUEST_PEPPER: Buffer.from(S.repeat(2).slice(0, 32).split("").reverse().join("")).toString("base64"),
  RENDERER_SECRET: HEX.split("").reverse().join(""),
  COPILOTKIT_TELEMETRY_DISABLED: "true",
  LLM_API_KEY: `sk-${S}`,
};

const FAILURES: Array<[string, NodeJS.ProcessEnv]> = [
  ["SUPABASE_URL missing", { SUPABASE_URL: undefined }],
  ["SUPABASE_URL not a supabase.co ref", { SUPABASE_URL: `https://${S}.example.com` }],
  ["SUPABASE_PUBLISHABLE_KEY without its prefix", { SUPABASE_PUBLISHABLE_KEY: `pk_${S}` }],
  ["SUPABASE_SECRET_KEY without its prefix", { SUPABASE_SECRET_KEY: `${S}_secret` }],
  ["AGENT_SERVICE_SECRET not 64 hex", { AGENT_SERVICE_SECRET: `${HEX}${S}` }],
  ["CREDENTIAL_KEYS empty", { CREDENTIAL_KEYS: `,${" ".repeat(3)},` }],
  ["CREDENTIAL_KEYS badly formed", { CREDENTIAL_KEYS: `${S}:${B64}` }],
  ["CREDENTIAL_KEYS not 32 bytes", { CREDENTIAL_KEYS: `v3:${S}` }],
  ["CREDENTIAL_KEYS duplicate version", { CREDENTIAL_KEYS: `v1:${B64},v1:${B64}` }],
  ["APP_ORIGIN with a path", { APP_ORIGIN: `https://${S}.example/${S}` }],
  ["APP_ORIGIN over http", { APP_ORIGIN: `http://${S}.example` }],
  ["ACCESS_REQUEST_PEPPER not 32 bytes", { ACCESS_REQUEST_PEPPER: `${S}==` }],
  ["RENDERER_SECRET not 64 hex", { RENDERER_SECRET: `${S}${HEX}` }],
  ["RENDERER_SECRET equal to AGENT_SERVICE_SECRET", { RENDERER_SECRET: HEX }],
  ["COPILOTKIT_TELEMETRY_DISABLED not true", { COPILOTKIT_TELEMETRY_DISABLED: S }],
  ["RENDERER_URL not http(s)", { RENDERER_URL: `ftp://${S}.example` }],
  ["RUN_TIME_LIMIT_SECONDS not a whole number", { RUN_TIME_LIMIT_SECONDS: S }],
  ["COPILOT_CONNECTS_PER_USER out of range", { COPILOT_CONNECTS_PER_USER: S }],
  ["COPILOT_CONNECT_MAX_MS out of range", { COPILOT_CONNECT_MAX_MS: S }],
];

function failure(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadHostedConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw new Error(`expected a ConfigError, got ${err instanceof Error ? err.name : typeof err}`);
  }
  throw new Error("expected loadHostedConfig to refuse the env");
}

const secretsOf = (env: NodeJS.ProcessEnv) => [
  S,
  ...Object.values(env)
    .filter((v): v is string => typeof v === "string" && v.length >= 8)
    .flatMap((v) => [v, ...v.split(/[,:]/).filter((p) => p.length >= 8)]),
];

describe("hosted config errors never echo a value", () => {
  it("accepts the sentinel env, so each case below fails only on its own variable", () => {
    expect(loadHostedConfig(VALID).supabaseUrl).toBe(VALID.SUPABASE_URL);
  });

  it.each(FAILURES)("%s: the ConfigError names the variable but no value", (_name, change) => {
    const env = { ...VALID, ...change };
    const err = failure(env);
    const text = [err.message, ...err.problems].join("\n");
    expect(err.problems.length).toBeGreaterThan(0);
    for (const secret of secretsOf(env)) expect(text.includes(secret), `a value reached: ${err.problems.join("; ")}`).toBe(false);
  });

  it("names every missing variable and no value when nothing is set", () => {
    const err = failure({});
    expect(err.problems).toEqual(
      expect.arrayContaining([
        "SUPABASE_URL is missing",
        "SUPABASE_PUBLISHABLE_KEY is missing",
        "SUPABASE_SECRET_KEY is missing",
        "AGENT_SERVICE_SECRET is missing",
        "CREDENTIAL_KEYS is missing",
        "APP_ORIGIN is missing",
        "ACCESS_REQUEST_PEPPER is missing",
        "RENDERER_SECRET is missing",
        "COPILOTKIT_TELEMETRY_DISABLED is missing",
      ]),
    );
  });
});
