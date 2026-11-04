import { UserError } from "@oab/core/lib/errors.js";
import { UNAVAILABLE_RETRY_S } from "../limits/config.js";
import type { VerifyOutcome } from "./turnstile.js";

export const HUMAN_CHECK_FAILED = "We couldn't verify that. Try again.";
export const HUMAN_CHECK_UNAVAILABLE = "Sign-up checks are unavailable right now. Try again in a minute.";

export const humanCheckFailed = () => new UserError(HUMAN_CHECK_FAILED, "forbidden", { code: "human_check_failed" });
export const humanCheckUnavailable = () =>
  new UserError(HUMAN_CHECK_UNAVAILABLE, "unavailable", { code: "human_check_unavailable", retryAfter: UNAVAILABLE_RETRY_S });

export function refusalOf(outcome: VerifyOutcome): UserError | undefined {
  if (outcome === "failed") return humanCheckFailed();
  if (outcome === "unavailable") return humanCheckUnavailable();
  return undefined;
}
