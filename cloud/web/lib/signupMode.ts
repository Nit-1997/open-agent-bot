import { isSignupMode, type SignupMode } from "@oab/shared/usage";
import { agentFetch } from "@/lib/agentServer";
import { ConfigError } from "@/lib/env";

export const SIGNUP_MODE_TTL_MS = 60_000;

export type SignupSettings = { mode: SignupMode; captcha: boolean };

const UNKNOWN: SignupSettings = Object.freeze({ mode: "waitlist", captcha: true });

let cached: { settings: SignupSettings; at: number } | undefined;

export function resetSignupModeCache(): void {
  cached = undefined;
}

const parse = (body: unknown): SignupSettings | undefined => {
  const b = body as { mode?: unknown; captcha?: unknown } | null | undefined;
  return isSignupMode(b?.mode) && typeof b?.captcha === "boolean" ? { mode: b.mode, captcha: b.captcha } : undefined;
};

export async function signupSettings(now: () => number = Date.now): Promise<SignupSettings> {
  if (cached && now() - cached.at < SIGNUP_MODE_TTL_MS) return cached.settings;
  try {
    const res = await agentFetch("/signup", null);
    const settings = res.ok ? parse(await res.json()) : undefined;
    if (!settings) return { ...UNKNOWN };
    cached = { settings, at: now() };
    return settings;
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    return { ...UNKNOWN };
  }
}

export async function signupMode(now: () => number = Date.now): Promise<SignupMode> {
  return (await signupSettings(now)).mode;
}
