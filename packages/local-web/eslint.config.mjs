import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const BOUNDARY = "packages/local-web must stay local-only: no Next, Supabase, core, bff, Node, web or cloud imports.";

const BLOCKED = [
  "next",
  "next*",
  "next/**",
  "next*/**",
  "@supabase/*",
  "@supabase/**",
  "@oab/core",
  "@oab/core/**",
  "@oab/bff",
  "@oab/bff/**",
  "node:*",
  "**/web/**",
  "**/web",
  "**/cloud/**",
  "**/cloud",
  "@oab/cloud",
  "@oab/cloud/**",
  "@oab/cloud-*",
  "@oab/cloud-*/**",
];

export default defineConfig([
  globalIgnores(["node_modules/**", "dist/**"]),
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: BLOCKED, message: BOUNDARY }] }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/^(next|@supabase\\/|@oab\\/(core|bff|cloud(-[\\w-]+)?)(\\/|$)|node:)|(^|\\/)(web|cloud)(\\/|$)/]",
          message: BOUNDARY,
        },
      ],
    },
  },
]);
