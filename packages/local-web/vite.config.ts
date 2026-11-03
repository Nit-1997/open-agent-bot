import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

export const sharedAlias = { find: /^@oab\/shared\/(.*)$/, replacement: fileURLToPath(new URL("../shared/src/$1", import.meta.url)) };

const DEV_INSPECTOR = "@copilotkit/web-inspector";
const DEV_INSPECTOR_STUB = "\0oab:copilotkit-web-inspector";

function dropDevInspector(): Plugin {
  return {
    name: "oab:drop-copilotkit-web-inspector",
    apply: "build",
    enforce: "pre",
    resolveId: (id) => (id === DEV_INSPECTOR ? DEV_INSPECTOR_STUB : null),
    load: (id) => (id === DEV_INSPECTOR_STUB ? "export {};" : null),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropDevInspector()],
  resolve: { alias: [sharedAlias] },
  build: { outDir: "dist", assetsDir: "assets", sourcemap: false, emptyOutDir: true },
});
