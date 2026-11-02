import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "@/lib/env";
import { SESSION_COOKIE_OPTIONS, sessionCookieOptions } from "./cookies";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();
  return createServerClient(url, publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, sessionCookieOptions(options));
        } catch {
          // Server Components can't set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
