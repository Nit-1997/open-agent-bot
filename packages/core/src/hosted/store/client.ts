import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "../../config.js";
import type { Database } from "./database.types.js";

export type Db = SupabaseClient<Database>;

export const DB_TIMEOUT_MS = 10_000;

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export function withTimeout(f: typeof fetch, ms: number = DB_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const limit = AbortSignal.timeout(ms);
    return f(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, limit]) : limit });
  };
}

type ClientOptions = { fetch?: typeof fetch; timeoutMs?: number };

function client(url: string, key: string, opts: ClientOptions): Db {
  return createClient<Database>(url, key, {
    auth: AUTH,
    db: { retry: false },
    global: { headers: { "x-client-info": "open-agent-agent" }, fetch: withTimeout(opts.fetch ?? fetch, opts.timeoutMs) },
  });
}

export const createServiceClient = (cfg: Pick<AgentConfig, "supabaseUrl" | "supabaseSecretKey">, opts: ClientOptions = {}): Db =>
  client(cfg.supabaseUrl, cfg.supabaseSecretKey, opts);

export const createAnonClient = (cfg: Pick<AgentConfig, "supabaseUrl" | "supabasePublishableKey">, opts: ClientOptions = {}): Db =>
  client(cfg.supabaseUrl, cfg.supabasePublishableKey, opts);
