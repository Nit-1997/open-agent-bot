import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { TransportInput } from "../run.js";
import type { AuthHeaders, Transport } from "../types.js";

export function readEnvFile(path: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  return Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}

function need(env: Record<string, string | undefined>, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`evals need ${name} (deploy-config/.env-agent or deploy-config/env-files/.env-supabase-admin)`);
  return v;
}

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export async function evalAuth(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<AuthHeaders> {
  const merged = {
    ...readEnvFile(resolve(repoRoot, "deploy-config/.env-agent")),
    ...readEnvFile(resolve(repoRoot, "deploy-config/env-files/.env-supabase-admin")),
    ...env,
  };
  const url = need(merged, "SUPABASE_URL");
  const email = merged.EVAL_USER_EMAIL?.trim() || "oab-eval@example.test";
  const service = createClient(url, need(merged, "SUPABASE_ADMIN_SECRET_KEY"), { auth: AUTH });
  const anon = createClient(url, need(merged, "SUPABASE_PUBLISHABLE_KEY"), {
    auth: { ...AUTH, persistSession: true, storage: memoryStorage() },
  });
  const secret = need(merged, "AGENT_SERVICE_SECRET");

  const link = await service.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`couldn't mint an eval session for ${email}: ${link.error.code ?? link.error.message}`);
  const verified = await anon.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (verified.error || !verified.data.session) throw new Error(`couldn't verify the eval link: ${verified.error?.code ?? "no session"}`);

  return async () => {
    const { data, error } = await anon.auth.getSession();
    if (error || !data.session) throw new Error("the eval session expired; rerun");
    if ((data.session.expires_at ?? 0) * 1000 - Date.now() < 60_000) {
      const refreshed = await anon.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) throw new Error("couldn't refresh the eval session");
      return { authorization: `Bearer ${refreshed.data.session.access_token}`, "x-agent-secret": secret };
    }
    return { authorization: `Bearer ${data.session.access_token}`, "x-agent-secret": secret };
  };
}

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
}

export async function hostedTarget(input: TransportInput): Promise<Transport> {
  return { url: input.url, headers: await evalAuth(input.repoRoot, input.env ?? process.env) };
}
