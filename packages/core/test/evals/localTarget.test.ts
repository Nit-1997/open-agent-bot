import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localTransport } from "../../evals/auth/local.js";
import { transportFor } from "../../evals/run.js";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGIN = "http://127.0.0.1:18340";
const KEY = `sk-or-v1-${"0".repeat(64)}`;

type Call = { url: string; init: RequestInit };

function fakeFetch(status = 200) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(status < 400 ? "{}" : JSON.stringify({ error: "bad_origin", message: "nope" }), { status });
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

describe("evals local transport", () => {
  it("posts runs to the front's CopilotKit run route with the Origin header", async () => {
    const { calls, fetch } = fakeFetch();
    const t = await localTransport({ origin: ORIGIN, fetch });
    expect(t.url).toBe(`${ORIGIN}/api/copilotkit/agent/openagent/run`);
    expect(await t.headers()).toEqual({ origin: ORIGIN });
    expect(calls).toHaveLength(0);
  });

  it("saves the OpenRouter key first, same origin, and never puts it in headers", async () => {
    const { calls, fetch } = fakeFetch();
    const t = await localTransport({ origin: ORIGIN, fetch, openrouterKey: KEY });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ORIGIN}/api/providers/openrouter/key`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ origin: ORIGIN, "content-type": "application/json" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ apiKey: KEY });
    expect(JSON.stringify(await t.headers())).not.toContain(KEY);
  });

  it("fails explicitly when the key is refused, without echoing the key", async () => {
    const { fetch } = fakeFetch(403);
    const err = await localTransport({ origin: ORIGIN, fetch, openrouterKey: KEY }).catch((e: Error) => e);
    expect(String(err)).toMatch(/couldn't save the OpenRouter key: HTTP 403 bad_origin/);
    expect(String(err)).not.toContain(KEY);
  });

  for (const origin of ["", "127.0.0.1:18340", "http://127.0.0.1:18340/", "http://127.0.0.1:18340/api", "ftp://127.0.0.1:18340"]) {
    it(`refuses the origin '${origin}'`, async () => {
      const { calls, fetch } = fakeFetch();
      await expect(localTransport({ origin, fetch })).rejects.toThrow(/--origin must be/);
      expect(calls).toHaveLength(0);
    });
  }
});

describe("evals target selection", () => {
  it("local needs --origin and reads the key from the named env variable", async () => {
    const { calls, fetch } = fakeFetch();
    await expect(transportFor({ target: "local", url: "", repoRoot: CORE, env: {}, fetch })).rejects.toThrow(/--origin/);
    await expect(transportFor({ target: "local", url: "", origin: ORIGIN, keyEnv: "EVAL_KEY", repoRoot: CORE, env: {}, fetch })).rejects.toThrow(
      /EVAL_KEY is empty or unset/,
    );
    const t = await transportFor({ target: "local", url: "", origin: ORIGIN, keyEnv: "EVAL_KEY", repoRoot: CORE, env: { EVAL_KEY: KEY }, fetch });
    expect(t.url).toBe(`${ORIGIN}/api/copilotkit/agent/openagent/run`);
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/api/providers/openrouter/key`]);
  });

  it("refuses an unknown target", async () => {
    await expect(transportFor({ target: "cloud", url: "", repoRoot: CORE, env: {} })).rejects.toThrow(/--target must be hosted or local/);
  });
});

function loadsSupabase(target: "local" | "hosted"): { supabase: boolean; out: string } {
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
const fetch = async () => new Response("{}", { status: 200 });
try {
  await transportFor({ target: ${JSON.stringify(target)}, url: "http://127.0.0.1:18800/agui", origin: "${ORIGIN}", repoRoot: ${JSON.stringify(dir)}, env: {}, fetch });
} catch (err) {
  console.log("transport error:", err instanceof Error ? err.message : String(err));
}
console.log("supabase loads:", globalThis.__supabaseLoads);
`,
  );
  const run = spawnSync(process.execPath, ["--import", hook, "--import", "tsx", probe], { cwd: CORE, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  const out = `${run.stdout}${run.stderr}`;
  const loads = Number(/supabase loads: (\d+)/.exec(out)?.[1] ?? Number.NaN);
  if (Number.isNaN(loads)) throw new Error(`the module-graph probe did not report: ${out}`);
  return { supabase: loads > 0, out };
}

describe("evals module graph", () => {
  it("run.ts with --target local never loads @supabase/supabase-js", () => {
    const { supabase, out } = loadsSupabase("local");
    expect(out).not.toMatch(/transport error/);
    expect(supabase).toBe(false);
  });

  it("the probe sees Supabase load for --target hosted (control)", () => {
    const { supabase, out } = loadsSupabase("hosted");
    expect(out).toMatch(/transport error: evals need SUPABASE_URL/);
    expect(supabase).toBe(true);
  });
});
