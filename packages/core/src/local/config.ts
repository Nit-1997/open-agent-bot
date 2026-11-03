import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, type CoreConfig, coreConfigFrom } from "../config.js";

export type ListenHost = "0.0.0.0" | "127.0.0.1";

export type LocalConfig = CoreConfig & {
  dataDir: string;
  keysDir: string;
  rendererDir: string;
  uiDir: string;
  publicPort: number;
  listenHost: ListenHost;
  listenPort: number;
  launchToken?: string;
  resetCredentials: boolean;
};

const DEFAULT_UI_DIR = fileURLToPath(new URL("../../../local-web/dist", import.meta.url));
const LISTEN_HOSTS: readonly ListenHost[] = ["0.0.0.0", "127.0.0.1"];
const HOSTED_NAMES = /^(SUPABASE_.*|AGENT_SERVICE_SECRET|CREDENTIAL_KEYS|RENDERER_SECRET)$/;
const HEX64 = /^[0-9a-f]{64}$/;

function portIn(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, problems: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = /^\d{1,5}$/.test(raw) ? Number(raw) : Number.NaN;
  if (n >= min && n <= 65535) return n;
  problems.push(`${name} must be a whole number from ${min} to 65535`);
  return fallback;
}

function dirIn(env: NodeJS.ProcessEnv, name: string, fallback: string, problems: string[]): string {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!isAbsolute(raw)) problems.push(`${name} must be an absolute path`);
  return raw;
}

function hostedSettings(env: NodeJS.ProcessEnv): string[] {
  const names = Object.keys(env)
    .filter((name) => HOSTED_NAMES.test(name) && env[name] !== undefined)
    .sort();
  return names.length ? [`the local stack takes no hosted settings; remove ${names.join(", ")}`] : [];
}

export function loadLocalConfig(env: NodeJS.ProcessEnv, secrets: { rendererSecret: string }): LocalConfig {
  const problems = hostedSettings(env);
  const core = coreConfigFrom({ ...env, RENDERER_SECRET: secrets.rendererSecret }, problems);

  const rawToken = env.OPEN_AGENT_LAUNCH_TOKEN ?? "";
  if (rawToken && !HEX64.test(rawToken)) problems.push("OPEN_AGENT_LAUNCH_TOKEN must be empty or 64 lowercase hex characters");

  const rawReset = env.OPEN_AGENT_RESET_CREDENTIALS ?? "";
  if (rawReset !== "" && rawReset !== "1") problems.push("OPEN_AGENT_RESET_CREDENTIALS must be 1 or empty");

  const rawHost = env.OPEN_AGENT_LISTEN_HOST?.trim() || "0.0.0.0";
  if (!(LISTEN_HOSTS as readonly string[]).includes(rawHost))
    problems.push(`OPEN_AGENT_LISTEN_HOST must be one of ${LISTEN_HOSTS.join(", ")}`);

  const config: LocalConfig = {
    ...core,
    dataDir: dirIn(env, "OPEN_AGENT_DATA_DIR", "/data", problems),
    keysDir: dirIn(env, "OPEN_AGENT_KEYS_DIR", "/keys", problems),
    rendererDir: dirIn(env, "OPEN_AGENT_RENDERER_DIR", "/run/open-agent/renderer", problems),
    uiDir: dirIn(env, "OPEN_AGENT_UI_DIR", DEFAULT_UI_DIR, problems),
    publicPort: portIn(env, "OPEN_AGENT_PORT", 3000, 1, problems),
    listenHost: rawHost as ListenHost,
    listenPort: portIn(env, "OPEN_AGENT_LISTEN_PORT", 3000, 0, problems),
    resetCredentials: rawReset === "1",
    ...(rawToken && HEX64.test(rawToken) && { launchToken: rawToken }),
  };
  if (problems.length) throw new ConfigError(problems);
  return config;
}
