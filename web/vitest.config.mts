import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/$1", import.meta.url)) },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./$1", import.meta.url)) },
      { find: /^typebox\/value$/, replacement: fileURLToPath(new URL("./node_modules/typebox/build/value/index.mjs", import.meta.url)) },
      { find: /^typebox$/, replacement: fileURLToPath(new URL("./node_modules/typebox/build/index.mjs", import.meta.url)) },
    ],
  },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["./test/setup.ts"] },
});
