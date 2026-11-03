import { LOG_LEVELS, type LogLevel } from "./lib/log.js";

export type ModelOption = { id: string; label: string; note?: string };

export type CredentialKeys = { current: number; keys: ReadonlyMap<number, Buffer> };

export type AgentConfig = {
  port: number;
  llmBaseUrl: string;
  llmApiKey?: string;
  searxngUrl: string;
  models: ModelOption[];
  jevModels: string[];
  jevConcurrency: number;
  logLevel: LogLevel;
  modelCaps: Record<string, string[]>;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  serviceSecret: string;
  credentialKeys: CredentialKeys;
  appOrigin: string;
  accessRequestPepper: Buffer;
  runTimeLimitSeconds: number;
  rendererUrl: string;
  rendererSecret: string;
};

export type CoreConfig = Pick<
  AgentConfig,
  | "port"
  | "searxngUrl"
  | "jevModels"
  | "jevConcurrency"
  | "logLevel"
  | "modelCaps"
  | "runTimeLimitSeconds"
  | "rendererUrl"
  | "rendererSecret"
>;

type ModelCap = "codemode";

export const JEV_MODELS = ["typesafe/jev-latest", "openrouter/typesafe/jev-1.14"];

const DEFAULT_CAPS: Array<{ match: RegExp; caps: ModelCap[] }> = [{ match: /sonnet/i, caps: ["codemode"] }];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`agent configuration is invalid: ${problems.join("; ")}`);
    this.name = "ConfigError";
  }
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

const decode32 = (b64: string): Buffer | undefined => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return undefined;
  const buf = Buffer.from(b64, "base64");
  return buf.length === 32 ? buf : undefined;
};

export function parseCredentialKeys(raw: string): CredentialKeys {
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (!entries.length) throw new Error("CREDENTIAL_KEYS is empty");
  const keys = new Map<number, Buffer>();
  for (const entry of entries) {
    const m = /^v([1-9]\d{0,5}):(.+)$/.exec(entry);
    if (!m) throw new Error("CREDENTIAL_KEYS entries must look like v<n>:<base64 of 32 bytes> with n ≥ 1");
    const version = Number(m[1]);
    const key = decode32(m[2]);
    if (!key) throw new Error(`CREDENTIAL_KEYS v${version} must decode to exactly 32 bytes`);
    if (keys.has(version)) throw new Error(`CREDENTIAL_KEYS lists v${version} twice`);
    keys.set(version, key);
  }
  return { current: Number(/^v(\d+)/.exec(entries[0])![1]), keys };
}

function origin(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.origin === raw ? raw : undefined;
  } catch {
    return undefined;
  }
}

function httpUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) ? u.href.replace(/\/+$/, "") : undefined;
  } catch {
    return undefined;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const problems: string[] = [];
  const need = <T>(name: string, parse: (v: string) => T | undefined, why: string): T => {
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

  const supabaseUrl = need(
    "SUPABASE_URL",
    (v) => (/^https:\/\/[a-z]{20}\.supabase\.co$/.test(v) ? v : undefined),
    "must be https://<ref>.supabase.co",
  );
  const supabasePublishableKey = need(
    "SUPABASE_PUBLISHABLE_KEY",
    (v) => (v.startsWith("sb_publishable_") ? v : undefined),
    "must start with sb_publishable_",
  );
  const supabaseSecretKey = need("SUPABASE_SECRET_KEY", (v) => (v.startsWith("sb_secret_") ? v : undefined), "must start with sb_secret_");
  const serviceSecret = need("AGENT_SERVICE_SECRET", (v) => (/^[0-9a-f]{64}$/.test(v) ? v : undefined), "must be 64 hex characters");
  const credentialKeys = need("CREDENTIAL_KEYS", parseCredentialKeys, "is invalid");
  const appOrigin = need("APP_ORIGIN", origin, "must be an https origin with no path or trailing slash");
  const accessRequestPepper = need("ACCESS_REQUEST_PEPPER", decode32, "must be base64 of exactly 32 bytes");
  const rendererSecret = need("RENDERER_SECRET", (v) => (/^[0-9a-f]{64}$/.test(v) ? v : undefined), "must be 64 hex characters");
  if (rendererSecret && rendererSecret === serviceSecret) problems.push("RENDERER_SECRET must differ from AGENT_SERVICE_SECRET");
  const rendererUrl = httpUrl(env.RENDERER_URL?.trim() || "http://renderer:8100");
  if (!rendererUrl) problems.push("RENDERER_URL must be an http(s) URL");
  const rawLimit = env.RUN_TIME_LIMIT_SECONDS?.trim();
  const runTimeLimitSeconds = rawLimit ? Number(rawLimit) : 280;
  if (!Number.isInteger(runTimeLimitSeconds) || runTimeLimitSeconds < 30 || runTimeLimitSeconds > 3600)
    problems.push("RUN_TIME_LIMIT_SECONDS must be a whole number from 30 to 3600");

  if (problems.length) throw new ConfigError(problems);

  return {
    port: Number(env.AGENT_PORT ?? 8000),
    llmBaseUrl: env.LLM_BASE_URL ?? "http://llm:4000/v1",
    llmApiKey: env.LLM_API_KEY || undefined,
    searxngUrl: env.SEARXNG_URL ?? "http://search:8080",
    models: parseModels(env.AGENT_MODELS),
    jevModels: env.JEV_MODEL ? [env.JEV_MODEL] : JEV_MODELS,
    jevConcurrency: Math.max(1, Number(env.JEV_CONCURRENCY) || 64),
    modelCaps: parseCaps(env.AGENT_MODEL_CAPS),
    logLevel: (LOG_LEVELS as readonly string[]).includes(env.LOG_LEVEL ?? "") ? (env.LOG_LEVEL as LogLevel) : "info",
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    serviceSecret,
    credentialKeys,
    appOrigin,
    accessRequestPepper,
    runTimeLimitSeconds,
    rendererUrl: rendererUrl as string,
    rendererSecret,
  };
}
