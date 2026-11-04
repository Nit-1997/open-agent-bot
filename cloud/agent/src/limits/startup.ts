import { log } from "@oab/core/lib/log.js";
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
