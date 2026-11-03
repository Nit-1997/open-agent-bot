import { createHash, timingSafeEqual } from "node:crypto";
import type { UserStatusCache } from "./status.js";
import { AuthError, type Verifier, type VerifiedUser } from "./verify.js";
import type { AuthOutcome, Identity, Principal } from "@oab/core/identity/types.js";
import { UserError } from "@oab/core/lib/errors.js";
import { log } from "@oab/core/lib/log.js";

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]+)$/;

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

export function serviceSecretMatches(given: string | undefined, expected: string): boolean {
  return timingSafeEqual(digest(given ?? ""), digest(expected)) && given !== undefined;
}

const unauthorized = () => new UserError("Unauthorized.", "unauthorized");
const signedOut = () => new UserError("You were signed out. Sign in again.", "unauthorized", { code: "signed_out" });
export const authUnavailable = () =>
  new UserError("Can't reach the account service. Try again in a minute.", "unavailable", { code: "auth_unavailable" });
const disabled = () => new UserError("Your access has been turned off.", "forbidden", { code: "account_disabled" });

const refuse = (error: UserError): AuthOutcome => ({ ok: false, error });

export const principalOf = ({ id, email, isAdmin }: VerifiedUser): Principal => Object.freeze({ id, email, isAdmin });

export function createSupabaseIdentity(deps: { serviceSecret: string; verify: Verifier; status: UserStatusCache }): Identity {
  return {
    kind: "hosted",

    admitCaller(req) {
      return serviceSecretMatches(req.headers.get("x-agent-secret") ?? undefined, deps.serviceSecret) ? undefined : unauthorized();
    },

    async authenticate(req) {
      const m = BEARER.exec(req.headers.get("authorization") ?? "");
      if (!m) return refuse(signedOut());
      let user: VerifiedUser;
      try {
        user = await deps.verify(m[1]);
      } catch (err) {
        if (err instanceof AuthError && err.code === "auth_unavailable") return refuse(authUnavailable());
        return refuse(signedOut());
      }
      let active: boolean;
      try {
        active = await deps.status.isActive(user.id);
      } catch (err) {
        log.warn(`[auth] status lookup failed user=${user.id}`, err instanceof UserError ? err.kind : "error");
        return refuse(authUnavailable());
      }
      if (!active) return refuse(disabled());
      return { ok: true, principal: principalOf(user) };
    },
  };
}
