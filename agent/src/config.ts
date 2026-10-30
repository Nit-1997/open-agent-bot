import { LOG_LEVELS, type LogLevel } from "./lib/log.js";

export type ModelOption = { id: string; label: string; note?: string };

export type AgentConfig = {
  port: number;
  llmBaseUrl: string;
  llmApiKey?: string;
  model: string;
  searxngUrl: string;
  braveApiKey?: string;
  artifactsDir: string;
  sharedSecret?: string;
  dataDir: string;
  models: ModelOption[];
  jevModel: string;
  jevConcurrency: number;
  logLevel: LogLevel;
  modelCaps: Record<string, string[]>;
};

type ModelCap = "codemode";

function parseCaps(raw: string | undefined): Record<string, string[]> {
  return Object.fromEntries(
    (raw ?? "")
      .split("|")
      .map((entry) => entry.split("=").map((p) => p.trim()))
      .filter(([id, caps]) => id && caps)
      .map(([id, caps]) => [
        id,
        caps
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      ]),
  );
}

export function hasCap(cfg: Pick<AgentConfig, "modelCaps">, ref: string | undefined, cap: ModelCap): boolean {
  if (!ref) return false;
  const bare = ref.startsWith("litellm/") ? ref.slice("litellm/".length) : ref;
  return (cfg.modelCaps[ref] ?? cfg.modelCaps[bare] ?? []).includes(cap);
}

function parseModels(raw: string | undefined, fallback: string): ModelOption[] {
  const listed = (raw ?? "")
    .split("|")
    .map((entry) => entry.split("=").map((p) => p.trim()))
    .filter(([id]) => id)
    .map(([id, label, note]): ModelOption => (note ? { id, label: label || id, note } : { id, label: label || id }));
  return listed.some((m) => m.id === fallback) ? listed : [{ id: fallback, label: fallback }, ...listed];
}

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const model = env.AGENT_MODEL ?? "chat-default";
  return {
    port: Number(env.AGENT_PORT ?? 8000),
    llmBaseUrl: env.LLM_BASE_URL ?? "http://llm:4000/v1",
    llmApiKey: env.LLM_API_KEY || undefined,
    model,
    searxngUrl: env.SEARXNG_URL ?? "http://search:8080",
    braveApiKey: env.BRAVE_SEARCH_API_KEY || undefined,
    artifactsDir: env.ARTIFACTS_DIR ?? "/data/artifacts",
    sharedSecret: env.AGENT_SHARED_SECRET || undefined,
    dataDir: env.AGENT_DATA_DIR ?? "/data/agent",
    models: parseModels(env.AGENT_MODELS, model),
    jevModel: env.JEV_MODEL || "openrouter/typesafe/jev-1.14",
    jevConcurrency: Math.max(1, Number(env.JEV_CONCURRENCY) || 64),
    modelCaps: parseCaps(env.AGENT_MODEL_CAPS),
    logLevel: (LOG_LEVELS as readonly string[]).includes(env.LOG_LEVEL ?? "") ? (env.LOG_LEVEL as LogLevel) : "info",
  };
}
