import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@oab\/shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/src/$1", import.meta.url)) }],
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    server: { deps: { inline: [/@copilotkit\//] } },
  },
});
