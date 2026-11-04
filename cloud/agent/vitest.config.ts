import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const resolve = createRequire(import.meta.url).resolve;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@oab\/core\/(.*)\.js$/, replacement: fileURLToPath(new URL("../../packages/core/src/$1.ts", import.meta.url)) },
      { find: /^@oab\/shared\/(.*)$/, replacement: fileURLToPath(new URL("../../packages/shared/src/$1.ts", import.meta.url)) },
      { find: /^typebox\/value$/, replacement: resolve("typebox/value") },
      { find: /^typebox$/, replacement: resolve("typebox") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.local.test.ts"],
    setupFiles: [fileURLToPath(new URL("../../packages/core/test/setup.ts", import.meta.url))],
    testTimeout: 30000,
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
