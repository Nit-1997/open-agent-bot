import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envReader, readEnvFiles } from "./env.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const env = envReader(
  process.env,
  () => readEnvFiles([resolve(ROOT, "deploy-config/env-files/.env-supabase-admin"), resolve(ROOT, "deploy-config/env-files/.env-e2e")]),
  "deploy-config/env-files/.env-supabase-admin",
);

export const scriptEnv = () => ({
  ...process.env,
  SUPABASE_URL: env("SUPABASE_URL"),
  SUPABASE_ADMIN_SECRET_KEY: env("SUPABASE_ADMIN_SECRET_KEY"),
  APP_ORIGIN: env("APP_ORIGIN"),
});

export const AUTH_DIR = resolve(ROOT, "e2e/.auth");
