import type { AgentConfig } from "../config.js";
import type { ProviderHub } from "../providers/hub.js";

export function defaultModelRef(cfg: AgentConfig, hub: Pick<ProviderHub, "resolve" | "enabledModels">): string | null {
  const preferred = cfg.model.includes("/") ? cfg.model : `litellm/${cfg.model}`;
  if (hub.resolve(preferred)) return preferred;
  return hub.enabledModels()[0]?.id ?? null;
}
