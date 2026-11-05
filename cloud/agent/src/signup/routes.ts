import { body, safe } from "@oab/core/http/handlers.js";
import type { AuthEnv } from "@oab/core/identity/types.js";
import { log } from "@oab/core/lib/log.js";
import type { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { rateLimitError } from "@oab/core/lib/rateLimit.js";
import type { HumanCheckState, SignupMode } from "@oab/shared/usage";
import { Hono } from "hono";
import { humanCheckUnavailable, refusalOf } from "../captcha/refusals.js";
import type { HumanVerifier } from "../captcha/turnstile.js";
import { clientIp } from "../http/clientIp.js";
import { HUMAN_CHECK_ROUTE } from "../limits/config.js";
import { gateApplies, type LiveHumanCheckGate } from "./humanCheck.js";

export type SignupRouteDeps = {
  mode: () => Promise<SignupMode | "unknown">;
  gate: Pick<LiveHumanCheckGate, "state" | "confirm">;
  verifier?: HumanVerifier;
  limiter: RateLimiter;
};

export function signupModeRoutes(deps: Pick<SignupRouteDeps, "mode">): Hono {
  const app = new Hono();
  app.get("/signup", async (c) => {
    const mode = await deps.mode();
    return c.json({ mode: mode === "unknown" ? "waitlist" : mode, captcha: gateApplies(mode) }, 200, { "cache-control": "no-store" });
  });
  return app;
}

export function humanCheckRoutes(deps: SignupRouteDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.post(
    "/human-check",
    safe<AuthEnv>(async (c) => {
      const user = c.get("user");
      const verdict = deps.limiter.take(`human-check:${user.id}`, HUMAN_CHECK_ROUTE);
      if (!verdict.ok) throw rateLimitError(verdict.retryAfter);
      const state = await deps.gate.state(user.id);
      if (state === "done" || state === "off") return c.json({ humanCheck: state satisfies HumanCheckState });
      if (state === "unavailable" || !deps.verifier) throw humanCheckUnavailable();
      const outcome = await deps.verifier.verify((await body(c)).token, {
        action: "human_check",
        remoteIp: clientIp(c.req.header("x-client-ip")),
      });
      const refusal = refusalOf(outcome);
      if (refusal) throw refusal;
      try {
        await deps.gate.confirm(user.id);
      } catch (err) {
        log.warn(`[signup] human check save failed user=${user.id}`, err instanceof Error ? err.message : err);
        throw humanCheckUnavailable();
      }
      return c.json({ humanCheck: "done" satisfies HumanCheckState });
    }),
  );
  return app;
}
