import type { MiddlewareHandler } from "hono";
import { errorResponse } from "../http/handlers.js";
import type { AuthEnv, Guards, Identity } from "./types.js";

export function createGuards(identity: Identity): Guards {
  const requireService: MiddlewareHandler = async (c, next) => {
    const refused = identity.admitCaller(c.req.raw);
    if (refused) return errorResponse(c, refused);
    await next();
  };

  const requireUser: MiddlewareHandler<AuthEnv> = async (c, next) => {
    const outcome = await identity.authenticate(c.req.raw);
    if (!outcome.ok) return errorResponse(c, outcome.error);
    c.set("user", outcome.principal);
    await next();
  };

  return { requireService, requireUser };
}
