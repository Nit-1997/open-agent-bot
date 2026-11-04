import type { AuthEnv } from "@oab/core/identity/types.js";
import { body, limitBy, pageParam, safe } from "@oab/core/http/handlers.js";
import { UserError } from "@oab/core/lib/errors.js";
import type { RateLimiter } from "@oab/core/lib/rateLimit.js";
import { isRequestFilter } from "@oab/shared/admin";
import { normalizeId } from "@oab/shared/ids";
import { PAGE_SIZE } from "@oab/shared/pages";
import { type Context, Hono } from "hono";
import type { AdminService } from "../admin/service.js";

const idParam = (c: Context<AuthEnv>, what: string): string => {
  const id = normalizeId(c.req.param("id"));
  if (!id) throw new UserError(`That ${what} doesn't exist.`, "not_found");
  return id;
};

export function adminRoutes(deps: { admin: AdminService; limiter: RateLimiter }) {
  const app = new Hono<AuthEnv>();
  const { admin } = deps;
  app.use("/admin/*", limitBy<AuthEnv>(deps.limiter, "admin"));

  app.get(
    "/admin/access-requests",
    safe<AuthEnv>(async (c) => {
      const status = c.req.query("status") ?? "pending";
      if (!isRequestFilter(status)) throw new UserError("status must be pending, approved, rejected or all", "invalid");
      const page = pageParam(c);
      return c.json({ ...(await admin.listRequests(status, page)), page, pageSize: PAGE_SIZE });
    }),
  );
  for (const action of ["approve", "reject", "resend"] as const) {
    app.post(
      `/admin/access-requests/:id/${action}`,
      safe<AuthEnv>(async (c) => c.json({ request: await admin[action](c.get("user"), idParam(c, "request")) })),
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
    safe<AuthEnv>(async (c) => c.json({ user: await admin.deactivate(c.get("user"), idParam(c, "user")) })),
  );
  app.post(
    "/admin/users/:id/reactivate",
    safe<AuthEnv>(async (c) => c.json({ user: await admin.reactivate(c.get("user"), idParam(c, "user")) })),
  );
  app.delete(
    "/admin/users/:id",
    safe<AuthEnv>(async (c) => {
      await admin.remove(c.get("user"), idParam(c, "user"), (await body(c)).confirmEmail);
      return c.json({ ok: true });
    }),
  );
  return app;
}
