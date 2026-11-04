import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: join(import.meta.dirname, "../..") });

const RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function restricted(code: string) {
  const [result] = await eslint.lintText(code, { filePath: "app/x.ts" });
  return result.messages.filter((m) => m.ruleId !== null && RULES.has(m.ruleId));
}

const blocked = [
  'import x from "../../../cloud/agent/store.ts";\nexport default x;\n',
  'export const load = () => import("../../cloud/web/x");\n',
  'export * from "../cloud/x";\n',
  'import x from "@oab/cloud";\nexport default x;\n',
  'import x from "@oab/cloud/agent";\nexport default x;\n',
];

const allowed = [
  'import x from "@google-cloud/storage";\nexport default x;\n',
  'import x from "./cloudinary.ts";\nexport default x;\n',
  'import x from "../clouds/x";\nexport default x;\n',
  'export const load = () => import("@google-cloud/storage");\n',
];

describe("no imports from cloud/", { timeout: 30000 }, () => {
  it.each(blocked)("blocks %s", async (code) => {
    const messages = await restricted(code);
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe(2);
    expect(messages[0].message).toContain("Nothing outside cloud/ may import from cloud/.");
  });

  it.each(allowed)("allows %s", async (code) => {
    expect(await restricted(code)).toEqual([]);
  });

  it("keeps the useAgentContext restriction", async () => {
    const messages = await restricted('import { useAgentContext } from "@copilotkit/react-core/v2";\nexport default useAgentContext;\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("useThreadContext");
  });
});
