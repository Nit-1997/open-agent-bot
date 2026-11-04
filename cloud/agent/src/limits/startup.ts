import { log } from "@oab/core/lib/log.js";
import { type SignupSettings, SignupLookupError } from "../signup/settings.js";
import { type UsageRepo, UsageRepoError } from "./usageRepo.js";

export const GATE8_REFUSAL = "refusing to start: the M7 usage functions are missing or not executable (apply the migrations first: Gate 8)";

const MISSING = new Set(["PGRST202", "42501"]);

export async function checkUsageFunctions(usage: Pick<UsageRepo, "summary">): Promise<"ok" | "missing" | "unknown"> {
  try {
    await usage.summary();
    return "ok";
  } catch (err) {
    const code = err instanceof UsageRepoError ? err.code : undefined;
    if (code && MISSING.has(code)) return "missing";
    log.warn(`[limits] usage startup check failed (${code ?? "error"}); runs fail closed until the database answers`);
    return "unknown";
  }
}

export async function checkSignupFunctions(
  signup: Pick<SignupSettings, "probe">,
  verifierConfigured: boolean,
): Promise<"ok" | "missing" | "unknown"> {
  try {
    const mode = await signup.probe();
    if (mode === "open" && !verifierConfigured) log.warn("[signup] open mode needs TURNSTILE_SECRET_KEY");
    return "ok";
  } catch (err) {
    const code = err instanceof SignupLookupError ? err.code : undefined;
    if (code && MISSING.has(code)) return "missing";
    log.warn(`[signup] signup settings startup check failed (${code ?? "error"}); the mode reads as unknown until the database answers`);
    return "unknown";
  }
}
