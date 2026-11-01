import { type AgentConfig, loadConfig } from "../../src/config.js";

export const TEST_SECRET = "a".repeat(64);
export const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

export const TEST_ENV: NodeJS.ProcessEnv = {
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  AGENT_SERVICE_SECRET: TEST_SECRET,
  CREDENTIAL_KEYS: `v1:${TEST_KEY_B64}`,
  APP_ORIGIN: "https://app.localhost",
  ACCESS_REQUEST_PEPPER: Buffer.alloc(32, 9).toString("base64"),
};

export const testConfig = (extra: NodeJS.ProcessEnv = {}): AgentConfig => loadConfig({ ...TEST_ENV, ...extra });
