import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const NEVER_FROM_FILES = new Set(["APP_ORIGIN", "E2E_ALLOW_LIVE"]);

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, "")];
      })
      .filter(([key]) => !NEVER_FROM_FILES.has(key)),
  );
}

export const readEnvFiles = (paths: readonly string[]): Record<string, string> =>
  Object.assign({}, ...paths.map((path) => readEnvFile(path)));

const files = readEnvFiles([
  resolve(ROOT, "deploy-config/env-files/.env-supabase-admin"),
  resolve(ROOT, "deploy-config/env-files/.env-e2e"),
]);

export const env = (name: string, optional = false): string => {
  const v = (process.env[name] ?? files[name] ?? "").trim();
  if (!v && !optional) throw new Error(`missing ${name} (deploy-config/env-files/.env-supabase-admin)`);
  return v;
};

export const scriptEnv = () => ({
  ...process.env,
  SUPABASE_URL: env("SUPABASE_URL"),
  SUPABASE_ADMIN_SECRET_KEY: env("SUPABASE_ADMIN_SECRET_KEY"),
  APP_ORIGIN: env("APP_ORIGIN"),
});

export const AUTH_DIR = resolve(ROOT, "e2e/.auth");
