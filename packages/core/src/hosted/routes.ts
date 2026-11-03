import type { AuthEnv, RouteMount } from "@oab/core/identity/types.js";
import type { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { Hono, type MiddlewareHandler } from "hono";
import type { AccessService } from "./access/service.js";
import type { AdminService } from "./admin/service.js";
import { accessRoutes } from "./http/access.js";
import { adminRoutes } from "./http/admin.js";

export type HostedRouteDeps = {
  access: AccessService;
  admin: AdminService;
  adminGuard: MiddlewareHandler<AuthEnv>;
  limiter: RateLimiter;
};

export function hostedRoutes(deps: HostedRouteDeps): RouteMount[] {
  const access = new Hono<AuthEnv>();
  access.route("/", accessRoutes({ access: deps.access }));
  const admin = new Hono<AuthEnv>();
  admin.use("/admin", deps.adminGuard);
  admin.use("/admin/*", deps.adminGuard);
  admin.route("/", adminRoutes({ admin: deps.admin, limiter: deps.limiter }));
  return [
    { stage: "public", basePath: "/", routes: access },
    { stage: "protected", basePath: "/admin", routes: admin },
  ];
}
