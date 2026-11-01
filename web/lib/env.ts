export class ConfigError extends Error {
  override name = "ConfigError";
}

function required(name: string, value: string | undefined, valid: (v: string) => boolean): string {
  if (!value) throw new ConfigError(`${name} is not set`);
  if (!valid(value)) throw new ConfigError(`${name} is invalid`);
  return value;
}

const isOrigin = (v: string) => {
  try {
    const url = new URL(v);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === v;
  } catch {
    return false;
  }
};

const isHttpUrl = (v: string) => {
  try {
    const url = new URL(v);
    return (url.protocol === "https:" || url.protocol === "http:") && !v.endsWith("/");
  } catch {
    return false;
  }
};

export function appOrigin(): string {
  return required("APP_ORIGIN", process.env.APP_ORIGIN, isOrigin);
}

export function agentBaseUrl(): string {
  return required("AGENT_URL", process.env.AGENT_URL, isHttpUrl);
}

export function serviceSecret(): string {
  return required("AGENT_SERVICE_SECRET", process.env.AGENT_SERVICE_SECRET, (v) => /^[0-9a-f]{64}$/.test(v));
}

export function supabaseEnv(): { url: string; publishableKey: string } {
  return {
    url: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL, isOrigin),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, (v) =>
      v.startsWith("sb_publishable_"),
    ),
  };
}
