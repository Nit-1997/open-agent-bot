import { setRetryDefaults } from "../src/lib/retry.js";

setRetryDefaults({ sleep: async () => {}, log: () => {} });

process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
