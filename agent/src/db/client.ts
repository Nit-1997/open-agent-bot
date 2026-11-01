import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "../config.js";

export type Db = SupabaseClient;

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export function createServiceClient(cfg: Pick<AgentConfig, "supabaseUrl" | "supabaseSecretKey">): Db {
  return createClient(cfg.supabaseUrl, cfg.supabaseSecretKey, { auth: AUTH, global: { headers: { "x-client-info": "open-agent-agent" } } });
}

export function createAnonClient(cfg: Pick<AgentConfig, "supabaseUrl" | "supabasePublishableKey">): Db {
  return createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: AUTH,
    global: { headers: { "x-client-info": "open-agent-agent" } },
  });
}
