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
      artifactsDir: "/data/artifacts",
      sharedSecret: undefined,
      models: [{ id: "chat-default", label: "chat-default" }],
    });
  });

  it("requires LLM_API_KEY", () => {
    expect(() => loadConfig({})).toThrow(/LLM_API_KEY/);
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
