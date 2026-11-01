import { Hono } from "hono";
import { type AccessService, normalizeEmail, padTo, RESPONSE_FLOOR_MS, readRequest } from "../access/service.js";
import { body, safe } from "./handlers.js";

const clientIp = (raw: string | undefined) => (raw ?? "").split(",")[0].trim().slice(0, 64) || "unknown";

export function accessRoutes(deps: { access: AccessService; floorMs?: number }) {
  const app = new Hono();
  const floor = deps.floorMs ?? RESPONSE_FLOOR_MS;

  app.post(
    "/access-requests",
    safe(async (c) => {
      const input = readRequest(await body(c));
      const ip = clientIp(c.req.header("x-client-ip"));
      await padTo(floor, () => deps.access.request(input, ip));
      return c.json({ ok: true }, 202);
    }),
  );
  app.post(
    "/auth/email-link",
    safe(async (c) => {
      const email = normalizeEmail((await body(c)).email);
      const ip = clientIp(c.req.header("x-client-ip"));
      await padTo(floor, () => deps.access.emailLink(email, ip));
      return c.json({ ok: true }, 202);
    }),
  );
  return app;
}
