import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: join(import.meta.dirname, "../..") });

async function restricted(code: string) {
  const [result] = await eslint.lintText(code, { filePath: "app/x.ts" });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("agent context lint", { timeout: 30000 }, () => {
  it("keeps the useAgentContext restriction", async () => {
    const messages = await restricted('import { useAgentContext } from "@copilotkit/react-core/v2";\nexport default useAgentContext;\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("useThreadContext");
  });
});
