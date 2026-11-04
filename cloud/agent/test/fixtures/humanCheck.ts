import type { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { HumanCheckGate } from "../../src/signup/humanCheck.js";
import type { SignupRouteDeps } from "../../src/signup/routes.js";

export const humanCheckOff: HumanCheckGate = { state: async () => "off" };

export const waitlistSignup = (limiter: RateLimiter): SignupRouteDeps => ({
  mode: async () => "waitlist",
  gate: { state: async () => "off", confirm: async () => {} },
  limiter,
});
