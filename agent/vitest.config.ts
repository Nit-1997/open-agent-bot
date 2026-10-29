import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const nm = (p: string) => fileURLToPath(new URL(`./node_modules/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^typebox\/value$/, replacement: nm("typebox/build/value/index.mjs") },
      { find: /^typebox$/, replacement: nm("typebox/build/index.mjs") },
    ],
  },
  test: { include: ["test/**/*.test.ts"], testTimeout: 30000, execArgv: ["--disable-warning=ExperimentalWarning"] },
});
