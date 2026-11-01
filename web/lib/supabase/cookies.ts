import type { CookieOptionsWithName } from "@supabase/ssr";

export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = { httpOnly: true, secure: true, sameSite: "lax", path: "/" };
