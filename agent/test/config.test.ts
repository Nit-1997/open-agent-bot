import { describe, expect, it } from "vitest";
import { hasCap, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads model capabilities and matches gateway refs with or without the litellm prefix", () => {
    const cfg = loadConfig({ AGENT_MODEL_CAPS: "chat-sonnet-5.5=codemode|openai/gpt-x=codemode" });
    expect(cfg.modelCaps["chat-sonnet-5.5"]).toEqual(["codemode"]);
    expect(hasCap(cfg, "litellm/chat-sonnet-5.5", "codemode")).toBe(true);
    expect(hasCap(cfg, "litellm/chat-default", "codemode")).toBe(false);
    expect(hasCap(cfg, "openai/gpt-x", "codemode")).toBe(true);
    expect(hasCap(cfg, undefined, "codemode")).toBe(false);
  });

  it("applies defaults with no environment at all", () => {
    expect(loadConfig({})).toEqual({
      port: 8000,
      llmBaseUrl: "http://llm:4000/v1",
      llmApiKey: undefined,
      searxngUrl: "http://search:8080",
      artifactsDir: "/data/artifacts",
      sharedSecret: undefined,
      sharedSecretFile: "/data/shared/agent-secret",
      dataDir: "/data/agent",
      models: [],
      jevModels: ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"],
      jevConcurrency: 64,
      modelCaps: {},
      logLevel: "info",
    });
  });

  it("keeps the secret file next to the data dir unless AGENT_SECRET_FILE is set", () => {
    expect(loadConfig({ AGENT_DATA_DIR: "/tmp/oa/agent" }).sharedSecretFile).toBe("/tmp/oa/shared/agent-secret");
    expect(loadConfig({ AGENT_SECRET_FILE: "/x/s" }).sharedSecretFile).toBe("/x/s");
  });

  it("tags Claude Sonnet models from any provider with codemode unless AGENT_MODEL_CAPS says otherwise", () => {
    const cfg = loadConfig({});
    expect(hasCap(cfg, "openrouter/anthropic/claude-sonnet-5.5", "codemode")).toBe(true);
    expect(hasCap(cfg, "anthropic/claude-sonnet-5-5", "codemode")).toBe(true);
    expect(hasCap(cfg, "openrouter/deepseek/deepseek-v4-flash", "codemode")).toBe(false);
    const off = loadConfig({ AGENT_MODEL_CAPS: "anthropic/claude-sonnet-5-5=none" });
    expect(hasCap(off, "anthropic/claude-sonnet-5-5", "codemode")).toBe(false);
  });

  it("reads LOG_LEVEL and ignores unknown levels", () => {
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
    expect(loadConfig({ LOG_LEVEL: "loud" }).logLevel).toBe("info");
  });

  it("pins Jev to JEV_MODEL when it is set", () => {
    expect(loadConfig({ JEV_MODEL: "openrouter/typesafe/jev-1.13" }).jevModels).toEqual(["openrouter/typesafe/jev-1.13"]);
  });

  it("treats LLM_API_KEY as optional, since providers can be added in the app", () => {
    expect(loadConfig({}).llmApiKey).toBeUndefined();
  });

  it("parses AGENT_PORT", () => {
    expect(loadConfig({ LLM_API_KEY: "k", AGENT_PORT: "9001" }).port).toBe(9001);
  });

  it("treats empty AGENT_SHARED_SECRET as unset", () => {
    expect(loadConfig({ LLM_API_KEY: "k", AGENT_SHARED_SECRET: "" }).sharedSecret).toBeUndefined();
  });

  it("parses AGENT_MODELS for the LiteLLM gateway", () => {
    const cfg = loadConfig({ AGENT_MODELS: "chat-sonnet-5.5=Sonnet 5.5=Best quality, about $0.05 a turn|chat-gemma4=Gemma 4" });
    expect(cfg.models).toEqual([
      { id: "chat-sonnet-5.5", label: "Sonnet 5.5", note: "Best quality, about $0.05 a turn" },
      { id: "chat-gemma4", label: "Gemma 4" },
    ]);
  });
});
