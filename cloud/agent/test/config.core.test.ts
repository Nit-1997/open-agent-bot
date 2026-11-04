import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config.js";
import { loadHostedConfig } from "../../src/hosted/config.js";
import { TEST_ENV } from "./fixtures/config.js";

const ALL_VARS = [
  "AGENT_PORT",
  "SEARXNG_URL",
  "JEV_MODEL",
  "JEV_CONCURRENCY",
  "AGENT_MODEL_CAPS",
  "LOG_LEVEL",
  "RUN_TIME_LIMIT_SECONDS",
  "RENDERER_URL",
  "RENDERER_SECRET",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "AGENT_SERVICE_SECRET",
  "CREDENTIAL_KEYS",
  "APP_ORIGIN",
  "ACCESS_REQUEST_PEPPER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "AGENT_MODELS",
  "COPILOTKIT_TELEMETRY_DISABLED",
  "COPILOT_CONNECTS_PER_USER",
  "COPILOT_CONNECT_MAX_MS",
];

describe("loadCoreConfig", () => {
  it("puts no env value into a ConfigError message from either loader", () => {
    const env = Object.fromEntries(ALL_VARS.map((name) => [name, `short-secret-value-${name}`]));
    for (const load of [loadHostedConfig]) {
      let message = "";
      try {
        load(env);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        message = (err as Error).message;
      }
      expect(message, load.name).not.toBe("");
      for (const name of ALL_VARS) expect(message, `${load.name} ${name}`).not.toContain(`short-secret-value-${name}`);
      expect(message).not.toContain("short-secret-value");
    }
  });
});

describe("copilot runtime settings", () => {
  it("refuses to start unless CopilotKit telemetry is disabled, naming the variable", () => {
    for (const load of [loadHostedConfig]) {
      const base = TEST_ENV;
      for (const value of [undefined, "", "false", "1", "TRUE"]) {
        const env = { ...base, COPILOTKIT_TELEMETRY_DISABLED: value };
        expect(() => load(env), `${load.name} ${value}`).toThrow(ConfigError);
        expect(() => load(env)).toThrow(/COPILOTKIT_TELEMETRY_DISABLED/);
      }
      expect(() => load({ ...base, COPILOTKIT_TELEMETRY_DISABLED: "true" })).not.toThrow();
    }
  });
});
