import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = createRequire(import.meta.url).resolve;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@oab\/core\/(.*)\.js$/, replacement: fileURLToPath(new URL("./src/$1.ts", import.meta.url)) },
      { find: /^@oab\/bff$/, replacement: fileURLToPath(new URL("../bff/src/index.ts", import.meta.url)) },
      { find: /^@oab\/shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/src/$1.ts", import.meta.url)) },
      { find: /^typebox\/value$/, replacement: resolve("typebox/value") },
      { find: /^typebox$/, replacement: resolve("typebox") },
    ],
  },
  test: { include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"], testTimeout: 30000, execArgv: ["--disable-warning=ExperimentalWarning"] },
});
