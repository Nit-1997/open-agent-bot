import { ConfigError, type CoreConfig, coreConfigFrom, type ModelOption, requireEnv } from "@oab/core/config.js";
import type { CredentialKeys } from "@oab/core/secrets/keyWrapper.js";
import { decode32, parseCredentialKeys } from "@oab/core/secrets/keys.js";

export type HostedEnvConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  serviceSecret: string;
  credentialKeys: CredentialKeys;
  appOrigin: string;
  accessRequestPepper: Buffer;
  llmBaseUrl: string;
  llmApiKey?: string;
  models: ModelOption[];
};

export type HostedConfig = CoreConfig & HostedEnvConfig;

function parseModels(raw: string | undefined): ModelOption[] {
  return (raw ?? "")
    .split("|")
    .map((entry) => entry.split("=").map((p) => p.trim()))
    .filter(([id]) => id)
    .map(([id, label, note]): ModelOption => (note ? { id, label: label || id, note } : { id, label: label || id }));
}

function origin(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.origin === raw ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function loadHostedConfig(env: NodeJS.ProcessEnv): HostedConfig {
  const problems: string[] = [];
  const need = requireEnv(env, problems);

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
  const core = coreConfigFrom(env, problems);
  if (core.rendererSecret && core.rendererSecret === serviceSecret) problems.push("RENDERER_SECRET must differ from AGENT_SERVICE_SECRET");

  if (problems.length) throw new ConfigError(problems);

  return {
    ...core,
    llmBaseUrl: env.LLM_BASE_URL ?? "http://llm:4000/v1",
    llmApiKey: env.LLM_API_KEY || undefined,
    models: parseModels(env.AGENT_MODELS),
    supabaseUrl,
    supabasePublishableKey,
    supabaseSecretKey,
    serviceSecret,
    credentialKeys,
    appOrigin,
    accessRequestPepper,
  };
}
