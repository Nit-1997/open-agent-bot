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
  copilotConnectsPerUser: number;
  copilotConnectMaxMs: number;
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

function wholeIn(raw: string | undefined, fallback: number, min: number, max: number): number | undefined {
  const n = raw?.trim() ? Number(raw.trim()) : fallback;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
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
  need("COPILOTKIT_TELEMETRY_DISABLED", (v) => (v === "true" ? v : undefined), 'must be "true"');
  const copilotConnectsPerUser = wholeIn(env.COPILOT_CONNECTS_PER_USER, 8, 1, 100);
  if (copilotConnectsPerUser === undefined) problems.push("COPILOT_CONNECTS_PER_USER must be a whole number from 1 to 100");
  const copilotConnectMaxMs = wholeIn(env.COPILOT_CONNECT_MAX_MS, 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000);
  if (copilotConnectMaxMs === undefined) problems.push("COPILOT_CONNECT_MAX_MS must be a whole number from 60000 to 86400000");

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
    copilotConnectsPerUser: copilotConnectsPerUser as number,
    copilotConnectMaxMs: copilotConnectMaxMs as number,
  };
}

export function loadCoreConfig(env: NodeJS.ProcessEnv): CoreConfig {
  const problems: string[] = [];
  const cfg = coreConfigFrom(env, problems);
  if (problems.length) throw new ConfigError(problems);
  return cfg;
}
