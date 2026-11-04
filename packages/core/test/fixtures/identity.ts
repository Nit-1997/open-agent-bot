import type { AuthOutcome, Identity, Principal } from "../../src/identity/types.js";
import { UserError } from "../../src/lib/errors.js";
import { secretMatches } from "../../src/lib/secretMatch.js";
import { TEST_SECRET } from "./config.js";

const BEARER = /^Bearer (\S+)$/;

export const tokenFor = (u: Principal) => `t.${u.id}`;

const unauthorized = () => new UserError("Unauthorized.", "unauthorized");

export function testIdentity(users: readonly Principal[], secret: string = TEST_SECRET): Identity {
  const byToken = new Map(users.map((u) => [tokenFor(u), u]));
  return Object.freeze({
    kind: "local" as const,
    admitCaller: (req: Request) => (secretMatches(req.headers.get("x-agent-secret") ?? undefined, secret) ? undefined : unauthorized()),
    authenticate: async (req: Request): Promise<AuthOutcome> => {
      const principal = byToken.get(BEARER.exec(req.headers.get("authorization") ?? "")?.[1] ?? "");
      return principal ? { ok: true, principal } : { ok: false, error: unauthorized() };
    },
  });
}
