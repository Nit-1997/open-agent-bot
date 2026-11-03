import { describe, expect, it } from "vitest";
import { ConfigError, hasCap } from "../src/config.js";
import { loadHostedConfig } from "../src/hosted/config.js";
import { TEST_ENV, testConfig } from "./fixtures/config.js";

const b64 = (n: number, fill = 1) => Buffer.alloc(n, fill).toString("base64");

describe("loadHostedConfig", () => {
  it("reads model capabilities and matches gateway refs with or without the litellm prefix", () => {
    const cfg = testConfig({ AGENT_MODEL_CAPS: "chat-sonnet-5.5=codemode|openai/gpt-x=codemode" });
    expect(cfg.modelCaps["chat-sonnet-5.5"]).toEqual(["codemode"]);
    expect(hasCap(cfg, "litellm/chat-sonnet-5.5", "codemode")).toBe(true);
    expect(hasCap(cfg, "litellm/chat-default", "codemode")).toBe(false);
    expect(hasCap(cfg, "openai/gpt-x", "codemode")).toBe(true);
    expect(hasCap(cfg, undefined, "codemode")).toBe(false);
  });

  it("applies defaults for the optional settings", () => {
    const cfg = testConfig();
    expect(cfg).toMatchObject({
      port: 8000,
      llmBaseUrl: "http://llm:4000/v1",
      llmApiKey: undefined,
      searxngUrl: "http://search:8080",
      models: [],
      jevModels: ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"],
      jevConcurrency: 64,
      modelCaps: {},
      logLevel: "info",
      runTimeLimitSeconds: 280,
      appOrigin: "https://app.localhost",
      rendererUrl: "http://renderer:8100",
    });
    expect(cfg.credentialKeys.current).toBe(1);
    expect(cfg.accessRequestPepper).toHaveLength(32);
  });

  it("returns exactly the config the single loader returned before the split", () => {
    expect(loadHostedConfig(TEST_ENV)).toStrictEqual({
      port: 8000,
      llmBaseUrl: "http://llm:4000/v1",
      llmApiKey: undefined,
      searxngUrl: "http://search:8080",
      models: [],
      jevModels: ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"],
      jevConcurrency: 64,
      modelCaps: {},
      logLevel: "info",
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
      supabasePublishableKey: "sb_publishable_test",
      supabaseSecretKey: "sb_secret_test",
      serviceSecret: "a".repeat(64),
      credentialKeys: { current: 1, keys: new Map([[1, Buffer.alloc(32, 7)]]) },
      appOrigin: "https://app.localhost",
      accessRequestPepper: Buffer.alloc(32, 9),
      runTimeLimitSeconds: 280,
      rendererUrl: "http://renderer:8100",
      rendererSecret: "b".repeat(64),
      copilotConnectsPerUser: 8,
      copilotConnectMaxMs: 1_800_000,
    });
  });

  it("reports the same set of problems as the single loader did for every failure case", () => {
    const cases: Array<[NodeJS.ProcessEnv, string[]]> = [
      [
        { SUPABASE_URL: "http://evil.example", AGENT_SERVICE_SECRET: "short-secret-value", APP_ORIGIN: "https://app.localhost/" },
        [
          "SUPABASE_URL must be https://<ref>.supabase.co",
          "SUPABASE_PUBLISHABLE_KEY is missing",
          "SUPABASE_SECRET_KEY is missing",
          "AGENT_SERVICE_SECRET must be 64 hex characters",
          "CREDENTIAL_KEYS is missing",
          "APP_ORIGIN must be an https origin with no path or trailing slash",
          "ACCESS_REQUEST_PEPPER is missing",
          "RENDERER_SECRET is missing",
          "COPILOTKIT_TELEMETRY_DISABLED is missing",
        ],
      ],
      [
        {},
        [
          "SUPABASE_URL is missing",
          "SUPABASE_PUBLISHABLE_KEY is missing",
          "SUPABASE_SECRET_KEY is missing",
          "AGENT_SERVICE_SECRET is missing",
          "CREDENTIAL_KEYS is missing",
          "APP_ORIGIN is missing",
          "ACCESS_REQUEST_PEPPER is missing",
          "RENDERER_SECRET is missing",
          "COPILOTKIT_TELEMETRY_DISABLED is missing",
        ],
      ],
      [{ ...TEST_ENV, SUPABASE_SECRET_KEY: "eyJhbGciOi" }, ["SUPABASE_SECRET_KEY must start with sb_secret_"]],
      [{ ...TEST_ENV, SUPABASE_PUBLISHABLE_KEY: "anon" }, ["SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_"]],
      [{ ...TEST_ENV, RUN_TIME_LIMIT_SECONDS: "10" }, ["RUN_TIME_LIMIT_SECONDS must be a whole number from 30 to 3600"]],
      [{ ...TEST_ENV, ACCESS_REQUEST_PEPPER: b64(16) }, ["ACCESS_REQUEST_PEPPER must be base64 of exactly 32 bytes"]],
      [{ ...TEST_ENV, RENDERER_SECRET: "abc" }, ["RENDERER_SECRET must be 64 hex characters"]],
      [{ ...TEST_ENV, RENDERER_SECRET: TEST_ENV.AGENT_SERVICE_SECRET }, ["RENDERER_SECRET must differ from AGENT_SERVICE_SECRET"]],
      [{ ...TEST_ENV, RENDERER_URL: "ftp://renderer" }, ["RENDERER_URL must be an http(s) URL"]],
    ];
    for (const [env, expected] of cases) {
      let problems: string[] = [];
      try {
        loadHostedConfig(env);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        problems = (err as ConfigError).problems;
      }
      expect(new Set(problems)).toEqual(new Set(expected));
      expect(problems).toHaveLength(expected.length);
    }
  });

  it("names every missing or invalid variable at once, without echoing values", () => {
    let err: unknown;
    try {
      loadHostedConfig({
        SUPABASE_URL: "http://evil.example",
        AGENT_SERVICE_SECRET: "short-secret-value",
        APP_ORIGIN: "https://app.localhost/",
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const message = (err as Error).message;
    for (const name of [
      "SUPABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "AGENT_SERVICE_SECRET",
      "CREDENTIAL_KEYS",
      "APP_ORIGIN",
      "ACCESS_REQUEST_PEPPER",
      "RENDERER_SECRET",
      "COPILOTKIT_TELEMETRY_DISABLED",
    ])
      expect(message).toContain(name);
    expect(message).not.toContain("short-secret-value");
  });

  it("checks key prefixes, the run time limit and the pepper length", () => {
    expect(() => loadHostedConfig({ ...TEST_ENV, SUPABASE_SECRET_KEY: "eyJhbGciOi" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => loadHostedConfig({ ...TEST_ENV, SUPABASE_PUBLISHABLE_KEY: "anon" })).toThrow(/SUPABASE_PUBLISHABLE_KEY/);
    expect(() => loadHostedConfig({ ...TEST_ENV, RUN_TIME_LIMIT_SECONDS: "10" })).toThrow(/RUN_TIME_LIMIT_SECONDS/);
    expect(() => loadHostedConfig({ ...TEST_ENV, ACCESS_REQUEST_PEPPER: b64(16) })).toThrow(/ACCESS_REQUEST_PEPPER/);
    expect(testConfig({ RUN_TIME_LIMIT_SECONDS: "780" }).runTimeLimitSeconds).toBe(780);
    expect(() => loadHostedConfig({ ...TEST_ENV, RENDERER_SECRET: "abc" })).toThrow(/RENDERER_SECRET/);
    expect(() => loadHostedConfig({ ...TEST_ENV, RENDERER_SECRET: TEST_ENV.AGENT_SERVICE_SECRET })).toThrow(/RENDERER_SECRET must differ/);
    expect(() => loadHostedConfig({ ...TEST_ENV, RENDERER_URL: "ftp://renderer" })).toThrow(/RENDERER_URL/);
    expect(testConfig({ RENDERER_URL: "http://127.0.0.1:8100/" }).rendererUrl).toBe("http://127.0.0.1:8100");
  });

  it("tags Claude Sonnet models from any provider with codemode unless AGENT_MODEL_CAPS says otherwise", () => {
    const cfg = testConfig();
    expect(hasCap(cfg, "openrouter/anthropic/claude-sonnet-5.5", "codemode")).toBe(true);
    expect(hasCap(cfg, "anthropic/claude-sonnet-5-5", "codemode")).toBe(true);
    expect(hasCap(cfg, "openrouter/deepseek/deepseek-v4-flash", "codemode")).toBe(false);
    const off = testConfig({ AGENT_MODEL_CAPS: "anthropic/claude-sonnet-5-5=none" });
    expect(hasCap(off, "anthropic/claude-sonnet-5-5", "codemode")).toBe(false);
  });

  it("reads LOG_LEVEL and ignores unknown levels", () => {
    expect(testConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
    expect(testConfig({ LOG_LEVEL: "loud" }).logLevel).toBe("info");
  });

  it("pins Jev to JEV_MODEL when it is set", () => {
    expect(testConfig({ JEV_MODEL: "openrouter/typesafe/jev-1.13" }).jevModels).toEqual(["openrouter/typesafe/jev-1.13"]);
  });

  it("parses AGENT_PORT and AGENT_MODELS for the LiteLLM gateway", () => {
    expect(testConfig({ AGENT_PORT: "9001" }).port).toBe(9001);
    const cfg = testConfig({ AGENT_MODELS: "chat-sonnet-5.5=Sonnet 5.5=Best quality, about $0.05 a turn|chat-gemma4=Gemma 4" });
    expect(cfg.models).toEqual([
      { id: "chat-sonnet-5.5", label: "Sonnet 5.5", note: "Best quality, about $0.05 a turn" },
      { id: "chat-gemma4", label: "Gemma 4" },
    ]);
  });
});
