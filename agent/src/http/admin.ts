import { Hono } from "hono";
import type { AdminService } from "../admin/service.js";
import type { AuthEnv } from "../auth/middleware.js";
import type { RequestFilter } from "../db/admin.js";
import { PAGE_SIZE } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import { limitBy, type RateLimiter } from "../lib/rateLimit.js";
import { body, pageParam, safe } from "./handlers.js";

const FILTERS: readonly RequestFilter[] = ["pending", "approved", "rejected", "all"];

export function adminRoutes(deps: { admin: AdminService; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  const { admin } = deps;
  app.use("*", limitBy<AuthEnv>(deps.limiter, "admin"));

  app.get(
    "/admin/access-requests",
    safe<AuthEnv>(async (c) => {
      const status = (c.req.query("status") ?? "pending") as RequestFilter;
      if (!FILTERS.includes(status)) throw new UserError("status must be pending, approved, rejected or all", "invalid");
      const page = pageParam(c);
      return c.json({ ...(await admin.listRequests(status, page)), page, pageSize: PAGE_SIZE });
    }),
  );
  for (const action of ["approve", "reject", "resend"] as const) {
    app.post(
      `/admin/access-requests/:id/${action}`,
      safe<AuthEnv>(async (c) => c.json({ request: await admin[action](c.get("user"), c.req.param("id") ?? "") })),
    );
  }
  app.get(
    "/admin/users",
    safe<AuthEnv>(async (c) => {
      const q = (c.req.query("q") ?? "").trim();
      if (q.length > 254) throw new UserError("q is too long", "invalid");
      const page = pageParam(c);
      return c.json({ ...(await admin.listUsers(page, q || undefined)), page, pageSize: PAGE_SIZE });
    }),
  );
  app.post(
    "/admin/users/:id/deactivate",
    safe<AuthEnv>(async (c) => c.json({ user: await admin.deactivate(c.get("user"), c.req.param("id") ?? "") })),
  );
  app.post(
    "/admin/users/:id/reactivate",
    safe<AuthEnv>(async (c) => c.json({ user: await admin.reactivate(c.get("user"), c.req.param("id") ?? "") })),
  );
  app.delete(
    "/admin/users/:id",
    safe<AuthEnv>(async (c) => {
      await admin.remove(c.get("user"), c.req.param("id") ?? "", (await body(c)).confirmEmail);
      return c.json({ ok: true });
    }),
  );
  return app;
}
