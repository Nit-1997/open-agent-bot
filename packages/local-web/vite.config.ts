import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export const sharedAlias = { find: /^@oab\/shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/src/$1", import.meta.url)) };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: [sharedAlias] },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false, emptyOutDir: true },
});
