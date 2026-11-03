import type { Hono, MiddlewareHandler } from "hono";
import type { UserError } from "../lib/errors.js";

export type Capabilities = Readonly<{
  admin: boolean;
  privateNetworkModels: boolean;
  operatorGateway: boolean;
}>;

export const NO_CAPABILITIES: Capabilities = Object.freeze({ admin: false, privateNetworkModels: false, operatorGateway: false });

export type Principal = Readonly<{ id: string; email: string; capabilities: Capabilities }>;

export type AuthOutcome = { ok: true; principal: Principal } | { ok: false; error: UserError };

export interface Identity {
  readonly kind: "hosted" | "local";
  admitCaller(req: Request): UserError | undefined;
  authenticate(req: Request): Promise<AuthOutcome>;
}

export type AuthEnv = { Variables: { user: Principal } };

export type Guards = { requireService: MiddlewareHandler; requireUser: MiddlewareHandler<AuthEnv> };

export type RouteMount = Readonly<{ stage: "public" | "protected"; basePath: string; routes: Hono<AuthEnv> }>;
