import { errorResponse } from "@oab/core/http/handlers.js";
import type { AuthEnv, Identity, Principal } from "@oab/core/identity/types.js";
import { UserError } from "@oab/core/lib/errors.js";
import type { MiddlewareHandler } from "hono";
import { authUnavailable } from "./supabaseIdentity.js";

export type AdminCheck = (principal: Principal) => Promise<boolean>;

export function createAdminGuard(deps: { identity: Identity; isLiveAdmin: AdminCheck }): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const outcome = await deps.identity.authenticate(c.req.raw);
    if (!outcome.ok) return errorResponse(c, outcome.error);
    const user = outcome.principal;
    c.set("user", user);
    let ok = false;
    try {
      ok = user.isAdmin && (await deps.isLiveAdmin(user));
    } catch {
      return errorResponse(c, authUnavailable());
    }
    if (!ok) return errorResponse(c, new UserError("Not found.", "not_found"));
    await next();
  };
}
