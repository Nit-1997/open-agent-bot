import { LOCAL_USER_EMAIL, LOCAL_USER_ID } from "@oab/shared/local";
import { UserError } from "../lib/errors.js";
import { secretMatches } from "../lib/secretMatch.js";
import type { AuthOutcome, Capabilities, Identity, Principal } from "./types.js";

const SECRET_RE = /^[0-9a-f]{64}$/;

export const LOCAL_CAPABILITIES: Capabilities = Object.freeze({ admin: false, privateNetworkModels: true, operatorGateway: false });

const PRINCIPAL: Principal = Object.freeze({ id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, capabilities: LOCAL_CAPABILITIES });

export const localPrincipal = (): Principal => PRINCIPAL;

const unauthorized = () => new UserError("Unauthorized.", "unauthorized");

export function createLocalIdentity(opts: { secret: string }): Identity {
  if (!SECRET_RE.test(opts.secret)) throw new Error("the local agent secret must be 64 lowercase hex characters");
  const { secret } = opts;
  const refused = (req: Request) => !secretMatches(req.headers.get("x-agent-secret") ?? undefined, secret);
  return Object.freeze({
    kind: "local" as const,
    admitCaller: (req: Request) => (refused(req) ? unauthorized() : undefined),
    authenticate: async (req: Request): Promise<AuthOutcome> =>
      refused(req) ? { ok: false, error: unauthorized() } : { ok: true, principal: PRINCIPAL },
  });
}
