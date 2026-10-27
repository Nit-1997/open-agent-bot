export type AgentConfig = {
  port: number;
  llmBaseUrl: string;
  llmApiKey: string;
  model: string;
  searxngUrl: string;
  artifactsDir: string;
  sharedSecret?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is required");
  return {
    port: Number(env.AGENT_PORT ?? 8000),
    llmBaseUrl: env.LLM_BASE_URL ?? "http://llm:4000/v1",
    llmApiKey: env.LLM_API_KEY,
    model: env.AGENT_MODEL ?? "chat-default",
    searxngUrl: env.SEARXNG_URL ?? "http://search:8080",
    artifactsDir: env.ARTIFACTS_DIR ?? "/data/artifacts",
    sharedSecret: env.AGENT_SHARED_SECRET || undefined,
  };
}
