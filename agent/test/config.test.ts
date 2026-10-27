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
});
