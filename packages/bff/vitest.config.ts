import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@oab\/shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/src/$1.ts", import.meta.url)) }],
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
