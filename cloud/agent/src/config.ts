import { ConfigError, type CoreConfig, coreConfigFrom, type ModelOption, requireEnv } from "@oab/core/config.js";
import type { CredentialKeys } from "@oab/core/secrets/keyWrapper.js";
import { decode32, parseCredentialKeys } from "@oab/core/secrets/keys.js";
import { log } from "@oab/core/lib/log.js";
import type { Limits } from "@oab/shared/usage";
import { isTestSecret } from "./captcha/turnstile.js";
import { limitsFrom } from "./limits/config.js";

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
  limits: Limits;
  turnstile?: TurnstileConfig;
  localStack?: true;
};

export type TurnstileConfig = { secret: string; verifyUrl?: string };

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

const HOSTED_SUPABASE = /^https:\/\/[a-z]{20}\.supabase\.co$/;
const LOCAL_PORT = "(187[0-4][0-9])";
const LOCAL_SUPABASE = new RegExp(`^http://127\\.0\\.0\\.1:${LOCAL_PORT}$`);
const LOCAL_ORIGIN = new RegExp(`^http://localhost:${LOCAL_PORT}$`);
const LOCAL_VERIFY_URL = new RegExp(`^http://127\\.0\\.0\\.1:${LOCAL_PORT}(/[A-Za-z0-9/_-]*)?$`);
const TURNSTILE_SECRET = /^[0-9]x[A-Za-z0-9_-]{20,200}$/;

function turnstileFrom(env: NodeJS.ProcessEnv, local: boolean, problems: string[]): TurnstileConfig | undefined {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const verifyUrl = env.TURNSTILE_VERIFY_URL?.trim();
  if (verifyUrl && !local) problems.push("TURNSTILE_VERIFY_URL is accepted only with SUPABASE_LOCAL_STACK=1");
  else if (verifyUrl && !LOCAL_VERIFY_URL.test(verifyUrl))
    problems.push("TURNSTILE_VERIFY_URL must be http://127.0.0.1:<18700-18749>[/path]");
  if (!secret) {
    if (verifyUrl) problems.push("TURNSTILE_VERIFY_URL needs TURNSTILE_SECRET_KEY");
    return undefined;
  }
  if (!TURNSTILE_SECRET.test(secret)) {
    problems.push("TURNSTILE_SECRET_KEY is not a Turnstile secret key");
    return undefined;
  }
  if (isTestSecret(secret) && !local) {
    problems.push("TURNSTILE_SECRET_KEY is a Cloudflare test secret; test secrets are accepted only with SUPABASE_LOCAL_STACK=1");
    return undefined;
  }
  return { secret, ...(verifyUrl && local && { verifyUrl }) };
}

function localStackFlag(env: NodeJS.ProcessEnv, problems: string[]): boolean {
  const v = env.SUPABASE_LOCAL_STACK;
  if (v === undefined || v === "") return false;
  if (v === "1") return true;
  problems.push("SUPABASE_LOCAL_STACK must be 1 or unset");
  return false;
}

export function loadHostedConfig(env: NodeJS.ProcessEnv): HostedConfig {
  const problems: string[] = [];
  const need = requireEnv(env, problems);
  const local = localStackFlag(env, problems);
  const orLocal = (text: string) => (local ? ` (${text} with SUPABASE_LOCAL_STACK=1)` : "");

  const supabaseUrl = need(
    "SUPABASE_URL",
    (v) => {
      if (!local) return HOSTED_SUPABASE.test(v) ? v : undefined;
      if (HOSTED_SUPABASE.test(v))
        throw new Error("SUPABASE_LOCAL_STACK=1 refuses a *.supabase.co SUPABASE_URL (local-stack mode is for tests on 127.0.0.1 only)");
      return LOCAL_SUPABASE.test(v) ? v : undefined;
    },
    `must be https://<ref>.supabase.co${orLocal("or http://127.0.0.1:<18700-18749>")}`,
  );
  const supabasePublishableKey = need(
    "SUPABASE_PUBLISHABLE_KEY",
    (v) => (v.startsWith("sb_publishable_") ? v : undefined),
    "must start with sb_publishable_",
  );
  const supabaseSecretKey = need("SUPABASE_SECRET_KEY", (v) => (v.startsWith("sb_secret_") ? v : undefined), "must start with sb_secret_");
  const serviceSecret = need("AGENT_SERVICE_SECRET", (v) => (/^[0-9a-f]{64}$/.test(v) ? v : undefined), "must be 64 hex characters");
  const credentialKeys = need("CREDENTIAL_KEYS", parseCredentialKeys, "is invalid");
  const appOrigin = need(
    "APP_ORIGIN",
    (v) => origin(v) ?? (local && LOCAL_ORIGIN.test(v) ? v : undefined),
    `must be an https origin with no path or trailing slash${orLocal("or http://localhost:<18700-18749>")}`,
  );
  const accessRequestPepper = need("ACCESS_REQUEST_PEPPER", decode32, "must be base64 of exactly 32 bytes");
  const core = coreConfigFrom(env, problems);
  const limits = limitsFrom(env, problems);
  const turnstile = turnstileFrom(env, local, problems);
  if (core.rendererSecret && core.rendererSecret === serviceSecret) problems.push("RENDERER_SECRET must differ from AGENT_SERVICE_SECRET");

  if (problems.length) throw new ConfigError(problems);
  if (local) log.warn("[config] LOCAL SUPABASE STACK MODE (tests only)");

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
    limits,
    ...(turnstile && { turnstile }),
    ...(local && { localStack: true as const }),
  };
}
