import { ConfigError, type CoreConfig, coreConfigFrom, type ModelOption, requireEnv } from "@oab/core/config.js";
import type { CredentialKeys } from "@oab/core/secrets/keyWrapper.js";

export type CloudConfig = {
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

export type HostedConfig = CoreConfig & CloudConfig;

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
