import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { sharedAlias } from "./vite.config.ts";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [sharedAlias] },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup.ts"],
    server: { deps: { inline: [/@copilotkit\//] } },
  },
});
