export type ModelOption = { id: string; label: string; note?: string };

export type AgentConfig = {
  port: number;
  llmBaseUrl: string;
  llmApiKey: string;
  model: string;
  searxngUrl: string;
  artifactsDir: string;
  sharedSecret?: string;
  models: ModelOption[];
};

function parseModels(raw: string | undefined, fallback: string): ModelOption[] {
  const listed = (raw ?? "")
    .split("|")
    .map((entry) => entry.split("=").map((p) => p.trim()))
    .filter(([id]) => id)
    .map(([id, label, note]): ModelOption => (note ? { id, label: label || id, note } : { id, label: label || id }));
  return listed.some((m) => m.id === fallback) ? listed : [{ id: fallback, label: fallback }, ...listed];
}

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required");
  const model = env.AGENT_MODEL ?? "chat-default";
  return {
    port: Number(env.AGENT_PORT ?? 8000),
    llmBaseUrl: env.LLM_BASE_URL ?? "http://llm:4000/v1",
    llmApiKey: env.LLM_API_KEY,
    model,
    searxngUrl: env.SEARXNG_URL ?? "http://search:8080",
    artifactsDir: env.ARTIFACTS_DIR ?? "/data/artifacts",
    sharedSecret: env.AGENT_SHARED_SECRET || undefined,
    models: parseModels(env.AGENT_MODELS, model),
  };
}
