import { dirname, join } from "node:path";
import { LOG_LEVELS, type LogLevel } from "./lib/log.js";

export type ModelOption = { id: string; label: string; note?: string };

export type AgentConfig = {
  port: number;
  llmBaseUrl: string;
  llmApiKey?: string;
  searxngUrl: string;
  artifactsDir: string;
  sharedSecret?: string;
  sharedSecretFile: string;
  dataDir: string;
  models: ModelOption[];
  jevModels: string[];
  jevConcurrency: number;
  logLevel: LogLevel;
  modelCaps: Record<string, string[]>;
};

type ModelCap = "codemode";

export const JEV_MODELS = ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"];

const DEFAULT_CAPS: Array<{ match: RegExp; caps: ModelCap[] }> = [{ match: /sonnet/i, caps: ["codemode"] }];

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
          .filter((c) => c && c !== "none"),
      ]),
  );
}

export function hasCap(cfg: Pick<AgentConfig, "modelCaps">, ref: string | undefined, cap: ModelCap): boolean {
  if (!ref) return false;
  const bare = ref.startsWith("litellm/") ? ref.slice("litellm/".length) : ref;
  const listed = cfg.modelCaps[ref] ?? cfg.modelCaps[bare];
  if (listed) return listed.includes(cap);
  return DEFAULT_CAPS.some((d) => d.match.test(ref) && d.caps.includes(cap));
}

function parseModels(raw: string | undefined): ModelOption[] {
  return (raw ?? "")
    .split("|")
    .map((entry) => entry.split("=").map((p) => p.trim()))
    .filter(([id]) => id)
    .map(([id, label, note]): ModelOption => (note ? { id, label: label || id, note } : { id, label: label || id }));
}

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const dataDir = env.AGENT_DATA_DIR ?? "/data/agent";
  return {
    port: Number(env.AGENT_PORT ?? 8000),
    llmBaseUrl: env.LLM_BASE_URL ?? "http://llm:4000/v1",
    llmApiKey: env.LLM_API_KEY || undefined,
    searxngUrl: env.SEARXNG_URL ?? "http://search:8080",
    artifactsDir: env.ARTIFACTS_DIR ?? "/data/artifacts",
    sharedSecret: env.AGENT_SHARED_SECRET || undefined,
    sharedSecretFile: env.AGENT_SECRET_FILE || join(dirname(dataDir), "shared", "agent-secret"),
    dataDir,
    models: parseModels(env.AGENT_MODELS),
    jevModels: env.JEV_MODEL ? [env.JEV_MODEL] : JEV_MODELS,
    jevConcurrency: Math.max(1, Number(env.JEV_CONCURRENCY) || 64),
    modelCaps: parseCaps(env.AGENT_MODEL_CAPS),
    logLevel: (LOG_LEVELS as readonly string[]).includes(env.LOG_LEVEL ?? "") ? (env.LOG_LEVEL as LogLevel) : "info",
  };
}
