import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envReader, readEnvFiles } from "../../../e2e/support/env.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const ENV_FILES = [resolve(ROOT, "cloud/deploy-config/env-files/ops/.env")];

export const env = envReader(process.env, () => readEnvFiles(ENV_FILES), "cloud/deploy-config/env-files/ops/.env");

export const scriptEnv = () => ({
  ...process.env,
  SUPABASE_URL: env("SUPABASE_URL"),
  SUPABASE_ADMIN_SECRET_KEY: env("SUPABASE_ADMIN_SECRET_KEY"),
  APP_ORIGIN: env("APP_ORIGIN"),
});

export const AUTH_DIR = resolve(ROOT, "cloud/e2e/.auth");
