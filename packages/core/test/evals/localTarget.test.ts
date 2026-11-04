import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localTransport } from "../../evals/auth/local.js";
import { CLI_TARGETS, transportFor } from "../../evals/run.js";
import { loadsSupabase } from "./moduleGraph.js";

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

  for (const origin of ["http://localhost:18340", "https://127.0.0.1:18340", "http://127.0.0.1"]) {
    it(`accepts the loopback origin '${origin}'`, async () => {
      const { fetch } = fakeFetch();
      expect((await localTransport({ origin, fetch })).url).toBe(`${origin}/api/copilotkit/agent/openagent/run`);
    });
  }

  for (const origin of [
    "https://app.example.com",
    "http://10.0.0.5:18330",
    "http://127.0.0.2:18330",
    "http://localhost.evil.example:18330",
    "http://[::1]:18330",
    "http://0.0.0.0:18330",
  ]) {
    it(`refuses the non-loopback origin '${origin}' before any request`, async () => {
      const { calls, fetch } = fakeFetch();
      await expect(localTransport({ origin, fetch, openrouterKey: KEY })).rejects.toThrow(
        /--target local only talks to 127\.0\.0\.1 or localhost/,
      );
      expect(calls).toHaveLength(0);
    });
  }

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
    await expect(
      transportFor({ target: "local", url: "", origin: ORIGIN, keyEnv: "EVAL_KEY", repoRoot: CORE, env: {}, fetch }),
    ).rejects.toThrow(/EVAL_KEY is empty or unset/);
    const t = await transportFor({
      target: "local",
      url: "",
      origin: ORIGIN,
      keyEnv: "EVAL_KEY",
      repoRoot: CORE,
      env: { EVAL_KEY: KEY },
      fetch,
    });
    expect(t.url).toBe(`${ORIGIN}/api/copilotkit/agent/openagent/run`);
    expect(calls.map((c) => c.url)).toEqual([`${ORIGIN}/api/providers/openrouter/key`]);
  });

  it("refuses an unknown target", async () => {
    await expect(transportFor({ target: "cloud", url: "", repoRoot: CORE, env: {} }, CLI_TARGETS)).rejects.toThrow(
      /--target must be hosted or local/,
    );
  });
});

describe("evals module graph", () => {
  it("run.ts with --target local never loads @supabase/supabase-js", () => {
    const { supabase, out } = loadsSupabase("local");
    expect(out).not.toMatch(/transport error/);
    expect(supabase).toBe(false);
  });
});
