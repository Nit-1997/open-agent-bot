import { Hono } from "hono";
import { type AccessService, normalizeEmail, readRequest } from "../access/service.js";
import { body, safe } from "../../http/handlers.js";

const clientIp = (raw: string | undefined) => (raw ?? "").split(",")[0].trim().slice(0, 64) || "unknown";

export function accessRoutes(deps: { access: AccessService }) {
  const app = new Hono();

  app.post(
    "/access-requests",
    safe(async (c) => {
      const input = readRequest(await body(c));
      deps.access.request(input, clientIp(c.req.header("x-client-ip")));
      return c.json({ ok: true }, 202);
    }),
  );
  app.post(
    "/auth/email-link",
    safe(async (c) => {
      const email = normalizeEmail((await body(c)).email);
      deps.access.emailLink(email, clientIp(c.req.header("x-client-ip")));
      return c.json({ ok: true }, 202);
    }),
  );
  return app;
}
