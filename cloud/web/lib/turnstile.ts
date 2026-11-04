import { ConfigError } from "@/lib/env";
import { envSiteKeyProblem } from "@/lib/turnstileKey";

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
export { siteKeyProblem } from "@/lib/turnstileKey";

export function turnstileSiteKey(): string | undefined {
  const problem = envSiteKeyProblem(process.env);
  if (problem) throw new ConfigError(problem);
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;
}
