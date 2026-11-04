import { errorResponse } from "@oab/core/http/handlers.js";
import type { AuthEnv, Principal } from "@oab/core/identity/types.js";
import { UserError } from "@oab/core/lib/errors.js";
import type { MiddlewareHandler } from "hono";
import { authUnavailable } from "./supabaseIdentity.js";

export type AdminCheck = (principal: Principal) => Promise<boolean>;

const notFound = () => new UserError("Not found.", "not_found");

export function createAdminGuard(deps: { isLiveAdmin: AdminCheck }): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user?.capabilities.admin) return errorResponse(c, notFound());
    let live: boolean;
    try {
      live = await deps.isLiveAdmin(user);
    } catch {
      return errorResponse(c, authUnavailable());
    }
    if (!live) return errorResponse(c, notFound());
    await next();
  };
}
