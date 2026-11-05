import { hostedCapabilities } from "./capabilities.js";
import type { UserStatusCache } from "./status.js";
import { AuthError, type Verifier, type VerifiedUser } from "./verify.js";
import type { AuthOutcome, Identity, Principal } from "@oab/core/identity/types.js";
import { UserError } from "@oab/core/lib/errors.js";
import { log } from "@oab/core/lib/log.js";
import { secretMatches as serviceSecretMatches } from "@oab/core/lib/secretMatch.js";

const BEARER = /^Bearer ([A-Za-z0-9._~+/=-]+)$/;

export { serviceSecretMatches };

const unauthorized = () => new UserError("Unauthorized.", "unauthorized");
const signedOut = () => new UserError("You were signed out. Sign in again.", "unauthorized", { code: "signed_out" });
export const authUnavailable = () =>
  new UserError("Can't reach the account service. Try again in a minute.", "unavailable", { code: "auth_unavailable" });
const disabled = () => new UserError("Your access has been turned off.", "forbidden", { code: "account_disabled" });

const refuse = (error: UserError): AuthOutcome => ({ ok: false, error });

export const principalOf = ({ id, email }: VerifiedUser, effectiveAdmin: boolean): Principal =>
  Object.freeze({ id, email, capabilities: hostedCapabilities(effectiveAdmin) });

const REMEMBERED_ADMINS = 10_000;

export type HostedIdentity = Identity & { roleUnverified(user: Principal): boolean };

export type HostedIdentityDeps = {
  serviceSecret: string;
  verify: Verifier;
  status: UserStatusCache;
  liveAdmin: (userId: string) => Promise<boolean>;
  onDemoted: (userId: string) => Promise<void>;
};

export function createSupabaseIdentity(deps: HostedIdentityDeps): HostedIdentity {
  const admins = new Set<string>();
  const unverified = new WeakSet<Principal>();

  const effectiveAdmin = async (user: VerifiedUser): Promise<boolean | undefined> => {
    if (!user.isAdmin) return false;
    try {
      return await deps.liveAdmin(user.id);
    } catch (err) {
      log.warn(`[auth] live admin check failed user=${user.id}`, err instanceof Error ? err.message : "error");
      return undefined;
    }
  };

  const remember = async (userId: string, admin: boolean) => {
    if (admin) {
      admins.delete(userId);
      admins.add(userId);
      if (admins.size > REMEMBERED_ADMINS) admins.delete(admins.values().next().value!);
      return;
    }
    if (!admins.delete(userId)) return;
    log.info(`[auth] admin role ended user=${userId}, dropping their sessions`);
    try {
      await deps.onDemoted(userId);
    } catch (err) {
      log.error(`[auth] demotion cleanup failed user=${userId}`, err instanceof Error ? err.message : err);
    }
  };

  return {
    kind: "hosted",

    roleUnverified: (user) => unverified.has(user),

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
      const admin = await effectiveAdmin(user);
      if (admin !== undefined) await remember(user.id, admin);
      const principal = principalOf(user, admin === true);
      if (admin === undefined) unverified.add(principal);
      return { ok: true, principal };
    },
  };
}
