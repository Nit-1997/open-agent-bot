import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../config.js";

export const LITELLM_PROVIDER = "litellm";

export function registerLitellm(runtime: ModelRuntime, cfg: AgentConfig): void {
  runtime.registerProvider(LITELLM_PROVIDER, {
    name: "LiteLLM",
    baseUrl: cfg.llmBaseUrl,
    apiKey: cfg.llmApiKey,
    api: "openai-completions",
    models: cfg.models.map((m) => ({
      id: m.id,
      name: m.label,
      reasoning: false,
      input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768,
      maxTokens: 4096,
    })),
  });
}
