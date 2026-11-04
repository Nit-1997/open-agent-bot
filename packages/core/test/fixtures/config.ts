import { type CoreConfig, loadCoreConfig } from "../../src/config.js";

export const TEST_SECRET = "a".repeat(64);
export const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

export const CORE_TEST_ENV: NodeJS.ProcessEnv = {
  RENDERER_SECRET: "b".repeat(64),
  COPILOTKIT_TELEMETRY_DISABLED: "true",
};

export const testConfig = (extra: NodeJS.ProcessEnv = {}): CoreConfig => loadCoreConfig({ ...CORE_TEST_ENV, ...extra });
