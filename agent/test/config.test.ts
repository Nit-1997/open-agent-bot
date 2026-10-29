import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
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
      flags: {
        jevRerank: false,
        promptV2: false,
        jevStays: false,
        jevMusic: false,
        turnBudget: false,
        sourcesV2: false,
        codemode: false,
        workspace: false,
        router: false,
        rpiv: false,
      },
    });
  });

  it("reads feature flags and the Jev model", () => {
    const cfg = loadConfig({ JEV_RERANK: "1", ROUTER: "true", CODEMODE: "off", JEV_MODEL: "typesafe/jev-latest" });
    expect(cfg.flags.jevRerank).toBe(true);
    expect(cfg.flags.router).toBe(true);
    expect(cfg.flags.codemode).toBe(false);
    expect(cfg.jevModel).toBe("typesafe/jev-latest");
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
