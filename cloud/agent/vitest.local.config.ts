import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { guardLocalEnv, HarnessRefusal } from "./test/local/harness.ts";
import base from "./vitest.config.ts";

let stack: ReturnType<typeof guardLocalEnv>;
try {
  stack = guardLocalEnv(process.env);
} catch (err) {
  if (!(err instanceof HarnessRefusal)) throw err;
  console.error(err.message.startsWith("local_stack_only") ? err.message : `local_stack_only: ${err.message}`);
  process.exit(2);
}
if (!stack) console.log("SKIP (no local stack)");

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: stack ? ["test/local/**/*.local.test.ts", "../supabase/test/**/*.local.test.ts"] : [],
    exclude: [],
    passWithNoTests: !stack,
    setupFiles: [...[base.test?.setupFiles ?? []].flat(), fileURLToPath(new URL("./test/local/setup.ts", import.meta.url))],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
