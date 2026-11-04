import type { CookieOptions, CookieOptionsWithName } from "@supabase/ssr";

export const SESSION_MAX_AGE_SECONDS = 720 * 60 * 60;

export const SESSION_COOKIE_OPTIONS: CookieOptionsWithName = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

export function sessionCookieOptions(options: CookieOptions): CookieOptions {
  const maxAge = options.maxAge === undefined ? SESSION_MAX_AGE_SECONDS : Math.min(options.maxAge, SESSION_MAX_AGE_SECONDS);
  return { ...options, maxAge };
}
