import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./hostedEnv";

export const admin = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_ADMIN_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
