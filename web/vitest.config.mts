import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = createRequire(import.meta.url).resolve;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/$1", import.meta.url)) },
      { find: /^@\/(.*)$/, replacement: fileURLToPath(new URL("./$1", import.meta.url)) },
      { find: /^typebox\/value$/, replacement: resolve("typebox/value") },
      { find: /^typebox$/, replacement: resolve("typebox") },
    ],
  },
  test: { environment: "jsdom", include: ["test/**/*.test.{ts,tsx}"], setupFiles: ["./test/setup.ts"] },
});
