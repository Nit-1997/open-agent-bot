import { body, safe } from "@oab/core/http/handlers.js";
import { Hono } from "hono";
import { type AccessService, normalizeEmail, readRequest } from "../access/service.js";
import { clientIp } from "./clientIp.js";

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
      const b = await body(c);
      await deps.access.emailLink(normalizeEmail(b.email), clientIp(c.req.header("x-client-ip")), b.captchaToken);
      return c.json({ ok: true }, 202);
    }),
  );
  return app;
}
