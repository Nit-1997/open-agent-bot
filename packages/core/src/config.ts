import { LOG_LEVELS, type LogLevel } from "./lib/log.js";

export type ModelOption = { id: string; label: string; note?: string };

export type CoreConfig = {
  port: number;
  searxngUrl: string;
  jevModels: string[];
  jevConcurrency: number;
  logLevel: LogLevel;
  modelCaps: Record<string, string[]>;
  runTimeLimitSeconds: number;
  rendererUrl: string;
  rendererSecret: string;
};

type ModelCap = "codemode";

export const JEV_MODELS = ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"];

const DEFAULT_CAPS: Array<{ match: RegExp; caps: ModelCap[] }> = [{ match: /sonnet/i, caps: ["codemode"] }];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`agent configuration is invalid: ${problems.join("; ")}`);
    this.name = "ConfigError";
  }
}

export type RequireEnv = <T>(name: string, parse: (v: string) => T | undefined, why: string) => T;

export function requireEnv(env: NodeJS.ProcessEnv, problems: string[]): RequireEnv {
  return <T>(name: string, parse: (v: string) => T | undefined, why: string): T => {
    const v = env[name]?.trim();
    if (!v) {
      problems.push(`${name} is missing`);
      return undefined as T;
    }
    try {
      const out = parse(v);
      if (out === undefined) problems.push(`${name} ${why}`);
      return out as T;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : `${name} ${why}`);
      return undefined as T;
    }
  };
}

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

export function hasCap(cfg: Pick<CoreConfig, "modelCaps">, ref: string | undefined, cap: ModelCap): boolean {
  if (!ref) return false;
  const bare = ref.startsWith("litellm/") ? ref.slice("litellm/".length) : ref;
  const listed = cfg.modelCaps[ref] ?? cfg.modelCaps[bare];
  if (listed) return listed.includes(cap);
  return DEFAULT_CAPS.some((d) => d.match.test(ref) && d.caps.includes(cap));
}

function httpUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.href.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

export function coreConfigFrom(env: NodeJS.ProcessEnv, problems: string[]): CoreConfig {
  const need = requireEnv(env, problems);
  const rendererSecret = need("RENDERER_SECRET", (v) => (/^[0-9a-f]{64}$/.test(v) ? v : undefined), "must be 64 hex characters");
  const rendererUrl = httpUrl(env.RENDERER_URL?.trim() || "http://renderer:8100");
  if (!rendererUrl) problems.push("RENDERER_URL must be an http(s) URL");
  const rawLimit = env.RUN_TIME_LIMIT_SECONDS?.trim();
  const runTimeLimitSeconds = rawLimit ? Number(rawLimit) : 280;
  if (!Number.isInteger(runTimeLimitSeconds) || runTimeLimitSeconds < 30 || runTimeLimitSeconds > 3600)
    problems.push("RUN_TIME_LIMIT_SECONDS must be a whole number from 30 to 3600");

  return {
    port: Number(env.AGENT_PORT ?? 8000),
    searxngUrl: env.SEARXNG_URL ?? "http://search:8080",
    jevModels: env.JEV_MODEL ? [env.JEV_MODEL] : JEV_MODELS,
    jevConcurrency: Math.max(1, Number(env.JEV_CONCURRENCY) || 64),
    modelCaps: parseCaps(env.AGENT_MODEL_CAPS),
    logLevel: (LOG_LEVELS as readonly string[]).includes(env.LOG_LEVEL ?? "") ? (env.LOG_LEVEL as LogLevel) : "info",
    runTimeLimitSeconds,
    rendererUrl: rendererUrl as string,
    rendererSecret,
  };
}

export function loadCoreConfig(env: NodeJS.ProcessEnv): CoreConfig {
  const problems: string[] = [];
  const cfg = coreConfigFrom(env, problems);
  if (problems.length) throw new ConfigError(problems);
  return cfg;
}
