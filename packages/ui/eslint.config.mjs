import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const BOUNDARY = "packages/ui must stay platform-neutral: no Next, Supabase, bff, core, server runtime, Node, web or cloud imports.";

const BLOCKED = [
  "next",
  "next/*",
  "@supabase/*",
  "@oab/bff",
  "@oab/bff/**",
  "@oab/core",
  "@oab/core/**",
  "@copilotkit/runtime",
  "@copilotkit/runtime/**",
  "hono",
  "hono/**",
  "node:*",
  "**/web/**",
  "**/cloud/**",
  "**/cloud",
  "@oab/cloud",
  "@oab/cloud/**",
  "@oab/cloud-*",
  "@oab/cloud-*/**",
  "@/*",
  "@/**",
];

export default defineConfig([
  globalIgnores(["node_modules/**"]),
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@copilotkit/react-core/v2",
              importNames: ["useAgentContext"],
              message: "Context goes to every agent. Use useThreadContext so it reaches only this chat's runs.",
            },
          ],
          patterns: [{ group: BLOCKED, message: BOUNDARY }],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression[source.value=/^(next|next\\/.*|@supabase\\/.*|@oab\\/(bff|core|cloud(-[\\w-]+)?)(\\/.*)?|@copilotkit\\/runtime(\\/.*)?|hono(\\/.*)?|node:.*|@\\/.*)$|(^|\\/)(web|cloud)(\\/|$)/]",
          message: BOUNDARY,
        },
      ],
    },
  },
]);
