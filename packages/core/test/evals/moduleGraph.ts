import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGIN = "http://127.0.0.1:18340";

export function loadsSupabase(target: "local" | "hosted", runFile = join(CORE, "evals/run.ts")): { supabase: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "oab-evals-graph-"));
  const hook = join(dir, "hook.mjs");
  const probe = join(dir, "probe.mts");
  writeFileSync(
    hook,
    `import { registerHooks } from "node:module";
globalThis.__supabaseLoads = 0;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@supabase/")) globalThis.__supabaseLoads += 1;
    return next(specifier, context);
  },
});
`,
  );
  writeFileSync(
    probe,
    `const { transportFor } = await import(${JSON.stringify(join(CORE, "evals/run.ts"))});
const { CLI_TARGETS } = await import(${JSON.stringify(runFile)});
const fetch = async () => new Response("{}", { status: 200 });
try {
  await transportFor({ target: ${JSON.stringify(target)}, url: "http://127.0.0.1:18800/agui", origin: "${ORIGIN}", repoRoot: ${JSON.stringify(dir)}, env: {}, fetch }, CLI_TARGETS);
} catch (err) {
  console.log("transport error:", err instanceof Error ? err.message : String(err));
}
console.log("supabase loads:", globalThis.__supabaseLoads);
`,
  );
  const run = spawnSync(process.execPath, ["--import", hook, "--import", "tsx", probe], {
    cwd: CORE,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const out = `${run.stdout}${run.stderr}`;
  const loads = Number(/supabase loads: (\d+)/.exec(out)?.[1] ?? Number.NaN);
  if (Number.isNaN(loads)) throw new Error(`the module-graph probe did not report: ${out}`);
  return { supabase: loads > 0, out };
}
