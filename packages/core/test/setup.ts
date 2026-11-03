import { setRetryDefaults } from "../src/lib/retry.js";

setRetryDefaults({ sleep: async () => {}, log: () => {} });
