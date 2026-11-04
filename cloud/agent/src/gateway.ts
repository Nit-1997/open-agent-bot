import type { GatewayLike } from "@oab/core/providers/hubFactory.js";
import type { HostedEnvConfig } from "./config.js";

export const hostedGateway = (cfg: Pick<HostedEnvConfig, "llmBaseUrl" | "llmApiKey" | "models">): GatewayLike | undefined =>
  cfg.llmApiKey ? { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, models: cfg.models } : undefined;
