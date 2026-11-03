import type { GatewayLike } from "@oab/core/startAgent.js";
import type { CloudConfig } from "./config.js";

export const hostedGateway = (cfg: Pick<CloudConfig, "llmBaseUrl" | "llmApiKey" | "models">): GatewayLike | undefined =>
  cfg.llmApiKey ? { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey, models: cfg.models } : undefined;
