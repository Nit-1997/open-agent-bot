const TEST_SITE_KEY_RE = /^[0-9]x0{20}[A-Z]{2}$/;
const SITE_KEY_RE = /^[0-9]x[A-Za-z0-9_-]{20,100}$/;
const LOCAL_SUPABASE_RE = /^http:\/\/127\.0\.0\.1:(187[0-4]\d)$/;

export function siteKeyProblem(key: string, supabaseUrl: string | undefined): string | undefined {
  if (!SITE_KEY_RE.test(key)) return "NEXT_PUBLIC_TURNSTILE_SITE_KEY is invalid";
  if (TEST_SITE_KEY_RE.test(key) && !LOCAL_SUPABASE_RE.test(supabaseUrl ?? ""))
    return "NEXT_PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key; test keys work only with a local Supabase stack (http://127.0.0.1:<18700-18749>)";
  return undefined;
}

export function envSiteKeyProblem(env: Record<string, string | undefined>): string | undefined {
  const key = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return key ? siteKeyProblem(key, env.NEXT_PUBLIC_SUPABASE_URL) : undefined;
}
