import { isSignupMode, type SignupMode } from "@oab/shared/usage";
import { agentFetch } from "@/lib/agentServer";
import { ConfigError } from "@/lib/env";

export const SIGNUP_MODE_TTL_MS = 60_000;

let cached: { mode: SignupMode; at: number } | undefined;

export function resetSignupModeCache(): void {
  cached = undefined;
}

export async function signupMode(now: () => number = Date.now): Promise<SignupMode> {
  if (cached && now() - cached.at < SIGNUP_MODE_TTL_MS) return cached.mode;
  try {
    const res = await agentFetch("/signup", null);
    const body = res.ok ? ((await res.json()) as { mode?: unknown }) : undefined;
    if (!isSignupMode(body?.mode)) return "waitlist";
    cached = { mode: body.mode, at: now() };
    return body.mode;
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    return "waitlist";
  }
}
