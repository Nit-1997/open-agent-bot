import type { AgentConfig } from "@oab/core/config.js";
import type { GatewayLike } from "@oab/core/startAgent.js";

export const hostedGateway = (cfg: Pick<AgentConfig, "llmBaseUrl" | "llmApiKey" | "models">): GatewayLike | undefined =>
  cfg.llmApiKey ? { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, models: cfg.models } : undefined;
