import { describe, expect, it } from "vitest";
import { ambientProviderEnv, providerEnvNames } from "../../src/ambientEnv.js";

describe("ambient provider credentials", () => {
  it("collects every env name pi's built-in providers would fall back to", async () => {
    const names = await providerEnvNames();
    for (const n of [
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENROUTER_API_KEY",
      "GEMINI_API_KEY",
      "GROQ_API_KEY",
      "TYPESAFE_API_KEY",
      "AWS_ACCESS_KEY_ID",
    ])
      expect(names).toContain(n);
    expect(names).not.toContain("LLM_API_KEY");
  });

  it("reports the provider variables that are set, and allows LLM_API_KEY", async () => {
    expect(await ambientProviderEnv({ OPENAI_API_KEY: "sk-x", LLM_API_KEY: "k", PATH: "/bin" })).toEqual(["OPENAI_API_KEY"]);
    expect(await ambientProviderEnv({ OPENAI_API_KEY: " ", LLM_API_KEY: "k" })).toEqual([]);
  });
});
