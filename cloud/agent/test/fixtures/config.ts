import { type HostedConfig, loadHostedConfig } from "../../src/config.js";
import { CORE_TEST_ENV, TEST_KEY_B64, TEST_SECRET } from "../../../../packages/core/test/fixtures/config.js";

export { TEST_KEY_B64, TEST_SECRET };

export const TEST_ENV: NodeJS.ProcessEnv = {
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  AGENT_SERVICE_SECRET: TEST_SECRET,
  CREDENTIAL_KEYS: `v1:${TEST_KEY_B64}`,
  APP_ORIGIN: "https://app.localhost",
  ACCESS_REQUEST_PEPPER: Buffer.alloc(32, 9).toString("base64"),
  ...CORE_TEST_ENV,
};

export const testConfig = (extra: NodeJS.ProcessEnv = {}): HostedConfig => loadHostedConfig({ ...TEST_ENV, ...extra });
