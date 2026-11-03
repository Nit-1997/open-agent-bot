import { describe, expect, it } from "vitest";
import { ConfigError, loadCoreConfig as loadCore } from "../src/config.js";
import { loadHostedConfig } from "../src/hosted/config.js";
import { TEST_ENV } from "./fixtures/config.js";

const RENDERER_SECRET = "b".repeat(64);
const TELEMETRY_OFF = { COPILOTKIT_TELEMETRY_DISABLED: "true" };
const loadCoreConfig = (env: NodeJS.ProcessEnv) => loadCore({ ...TELEMETRY_OFF, ...env });

const problemsOf = (load: () => unknown): string[] => {
  try {
    load();
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  throw new Error("expected a ConfigError");
};

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
  it("succeeds with only core variables", () => {
    const cfg = loadCoreConfig({ RENDERER_SECRET });
    expect(cfg).toEqual({
      port: 8000,
      searxngUrl: "http://search:8080",
      jevModels: ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"],
      jevConcurrency: 64,
      logLevel: "info",
      modelCaps: {},
      runTimeLimitSeconds: 280,
      rendererUrl: "http://renderer:8100",
      rendererSecret: RENDERER_SECRET,
      copilotConnectsPerUser: 8,
      copilotConnectMaxMs: 1_800_000,
    });
  });

  it("reports renderer and run time limit problems as before", () => {
    expect(problemsOf(() => loadCoreConfig({}))).toEqual(["RENDERER_SECRET is missing"]);
    expect(problemsOf(() => loadCoreConfig({ RENDERER_SECRET: "abc" }))).toEqual(["RENDERER_SECRET must be 64 hex characters"]);
    expect(problemsOf(() => loadCoreConfig({ RENDERER_SECRET, RUN_TIME_LIMIT_SECONDS: "10" }))).toEqual([
      "RUN_TIME_LIMIT_SECONDS must be a whole number from 30 to 3600",
    ]);
    expect(problemsOf(() => loadCoreConfig({ RENDERER_SECRET, RUN_TIME_LIMIT_SECONDS: "3601" }))).toEqual([
      "RUN_TIME_LIMIT_SECONDS must be a whole number from 30 to 3600",
    ]);
    expect(problemsOf(() => loadCoreConfig({ RENDERER_SECRET, RENDERER_URL: "ftp://renderer" }))).toEqual([
      "RENDERER_URL must be an http(s) URL",
    ]);
  });

  it("puts no env value into a ConfigError message from either loader", () => {
    const env = Object.fromEntries(ALL_VARS.map((name) => [name, `short-secret-value-${name}`]));
    for (const load of [loadCoreConfig, loadHostedConfig]) {
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
    for (const load of [loadCore, loadHostedConfig]) {
      const base = load === loadCore ? { RENDERER_SECRET } : TEST_ENV;
      for (const value of [undefined, "", "false", "1", "TRUE"]) {
        const env = { ...base, COPILOTKIT_TELEMETRY_DISABLED: value };
        expect(() => load(env), `${load.name} ${value}`).toThrow(ConfigError);
        expect(() => load(env)).toThrow(/COPILOTKIT_TELEMETRY_DISABLED/);
      }
      expect(() => load({ ...base, COPILOTKIT_TELEMETRY_DISABLED: "true" })).not.toThrow();
    }
  });

  it("reads the connect cap and maximum connect duration", () => {
    const cfg = loadCoreConfig({ RENDERER_SECRET, COPILOT_CONNECTS_PER_USER: "3", COPILOT_CONNECT_MAX_MS: "60000" });
    expect(cfg).toMatchObject({ copilotConnectsPerUser: 3, copilotConnectMaxMs: 60_000 });
    expect(problemsOf(() => loadCoreConfig({ RENDERER_SECRET, COPILOT_CONNECTS_PER_USER: "0" }))).toEqual([
      "COPILOT_CONNECTS_PER_USER must be a whole number from 1 to 100",
    ]);
    expect(problemsOf(() => loadCoreConfig({ RENDERER_SECRET, COPILOT_CONNECT_MAX_MS: "1.5" }))).toEqual([
      "COPILOT_CONNECT_MAX_MS must be a whole number from 60000 to 86400000",
    ]);
  });
});
