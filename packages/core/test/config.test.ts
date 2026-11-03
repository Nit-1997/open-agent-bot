import { describe, expect, it } from "vitest";
import { ConfigError, hasCap, loadConfig, parseCredentialKeys } from "../src/config.js";
import { TEST_ENV, testConfig } from "./fixtures/config.js";

const b64 = (n: number, fill = 1) => Buffer.alloc(n, fill).toString("base64");

describe("loadConfig", () => {
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

  it("names every missing or invalid variable at once, without echoing values", () => {
    let err: unknown;
    try {
      loadConfig({ SUPABASE_URL: "http://evil.example", AGENT_SERVICE_SECRET: "short-secret-value", APP_ORIGIN: "https://app.localhost/" });
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
    ])
      expect(message).toContain(name);
    expect(message).not.toContain("short-secret-value");
  });

  it("checks key prefixes, the run time limit and the pepper length", () => {
    expect(() => loadConfig({ ...TEST_ENV, SUPABASE_SECRET_KEY: "eyJhbGciOi" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => loadConfig({ ...TEST_ENV, SUPABASE_PUBLISHABLE_KEY: "anon" })).toThrow(/SUPABASE_PUBLISHABLE_KEY/);
    expect(() => loadConfig({ ...TEST_ENV, RUN_TIME_LIMIT_SECONDS: "10" })).toThrow(/RUN_TIME_LIMIT_SECONDS/);
    expect(() => loadConfig({ ...TEST_ENV, ACCESS_REQUEST_PEPPER: b64(16) })).toThrow(/ACCESS_REQUEST_PEPPER/);
    expect(testConfig({ RUN_TIME_LIMIT_SECONDS: "780" }).runTimeLimitSeconds).toBe(780);
    expect(() => loadConfig({ ...TEST_ENV, RENDERER_SECRET: "abc" })).toThrow(/RENDERER_SECRET/);
    expect(() => loadConfig({ ...TEST_ENV, RENDERER_SECRET: TEST_ENV.AGENT_SERVICE_SECRET })).toThrow(/RENDERER_SECRET must differ/);
    expect(() => loadConfig({ ...TEST_ENV, RENDERER_URL: "ftp://renderer" })).toThrow(/RENDERER_URL/);
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

describe("parseCredentialKeys", () => {
  it("takes the first entry as current and keeps older keys for reading", () => {
    const keys = parseCredentialKeys(`v2:${b64(32, 2)},v1:${b64(32, 1)}`);
    expect(keys.current).toBe(2);
    expect([...keys.keys.keys()]).toEqual([2, 1]);
  });

  it("rejects 31- and 33-byte keys, duplicate versions, v0 and junk", () => {
    expect(() => parseCredentialKeys(`v1:${b64(31)}`)).toThrow(/32 bytes/);
    expect(() => parseCredentialKeys(`v1:${b64(33)}`)).toThrow(/32 bytes/);
    expect(() => parseCredentialKeys(`v1:${b64(32)},v1:${b64(32, 2)}`)).toThrow(/twice/);
    expect(() => parseCredentialKeys(`v0:${b64(32)}`)).toThrow(/v<n>/);
    expect(() => parseCredentialKeys("")).toThrow(/empty/);
    expect(() => parseCredentialKeys("key")).toThrow(/v<n>/);
  });
});
