import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
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
          patterns: [
            {
              group: ["**/cloud", "**/cloud/**", "@oab/cloud", "@oab/cloud/**"],
              message: "Nothing outside cloud/ may import from cloud/.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/(^|\\/)cloud(\\/|$)/]",
          message: "Nothing outside cloud/ may import from cloud/.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
