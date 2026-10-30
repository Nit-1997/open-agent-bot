import { describe, expect, it } from "vitest";
import { hasCap, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads model capabilities and matches gateway refs with or without the litellm prefix", () => {
    const cfg = loadConfig({ AGENT_MODEL_CAPS: "chat-sonnet-5.5=codemode|openai/gpt-x=codemode" });
    expect(cfg.modelCaps["chat-sonnet-5.5"]).toEqual(["codemode"]);
    expect(hasCap(cfg, "litellm/chat-sonnet-5.5", "codemode")).toBe(true);
    expect(hasCap(cfg, "chat-default", "codemode")).toBe(false);
    expect(hasCap(cfg, "openai/gpt-x", "codemode")).toBe(true);
    expect(hasCap(cfg, undefined, "codemode")).toBe(false);
  });

  it("applies defaults", () => {
    expect(loadConfig({ LLM_API_KEY: "k" })).toEqual({
      port: 8000,
      llmBaseUrl: "http://llm:4000/v1",
      llmApiKey: "k",
      model: "chat-default",
      searxngUrl: "http://search:8080",
      braveApiKey: undefined,
      artifactsDir: "/data/artifacts",
      sharedSecret: undefined,
      dataDir: "/data/agent",
      models: [{ id: "chat-default", label: "chat-default" }],
      jevModel: "openrouter/typesafe/jev-1.14",
      jevConcurrency: 64,
      modelCaps: {},
      logLevel: "info",
    });
  });

  it("reads LOG_LEVEL and ignores unknown levels", () => {
    expect(loadConfig({ LOG_LEVEL: "debug" }).logLevel).toBe("debug");
    expect(loadConfig({ LOG_LEVEL: "loud" }).logLevel).toBe("info");
  });

  it("reads the Jev model", () => {
    expect(loadConfig({ JEV_MODEL: "typesafe/jev-latest" }).jevModel).toBe("typesafe/jev-latest");
  });

  it("treats LLM_API_KEY as optional, since providers can be added in the app", () => {
    expect(loadConfig({}).llmApiKey).toBeUndefined();
  });

  it("reads the optional Brave Search API key", () => {
    expect(loadConfig({ BRAVE_SEARCH_API_KEY: "b1" }).braveApiKey).toBe("b1");
    expect(loadConfig({ BRAVE_SEARCH_API_KEY: "" }).braveApiKey).toBeUndefined();
  });

  it("parses AGENT_PORT", () => {
    expect(loadConfig({ LLM_API_KEY: "k", AGENT_PORT: "9001" }).port).toBe(9001);
  });

  it("treats empty AGENT_SHARED_SECRET as unset", () => {
    expect(loadConfig({ LLM_API_KEY: "k", AGENT_SHARED_SECRET: "" }).sharedSecret).toBeUndefined();
  });

  it("parses AGENT_MODELS and always offers the default model", () => {
    const cfg = loadConfig({
      LLM_API_KEY: "k",
      AGENT_MODEL: "chat-default",
      AGENT_MODELS: "chat-sonnet-5.5=Sonnet 5.5=Best quality, about $0.05 a turn|chat-gemma4=Gemma 4",
    });
    expect(cfg.models).toEqual([
      { id: "chat-default", label: "chat-default" },
      { id: "chat-sonnet-5.5", label: "Sonnet 5.5", note: "Best quality, about $0.05 a turn" },
      { id: "chat-gemma4", label: "Gemma 4" },
    ]);
  });

  it("keeps the default's own label when it is listed", () => {
    const cfg = loadConfig({ LLM_API_KEY: "k", AGENT_MODEL: "chat-default", AGENT_MODELS: "chat-default=Qwen 3.5 (local)=Free" });
    expect(cfg.models).toEqual([{ id: "chat-default", label: "Qwen 3.5 (local)", note: "Free" }]);
  });
});
